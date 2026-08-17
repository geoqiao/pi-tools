import assert from "node:assert/strict";
import test from "node:test";
import { findLatestPayloadInCurrentBranch } from "../src/ask-payload-store.ts";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import { getAskConfigStore } from "../src/config/store.ts";
import {
	ASK_PENDING_DISMISSED_ENTRY_TYPE,
	findPendingAskToolCall,
} from "../src/pending-ask.ts";
import {
	createRemoteAskRuntime,
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
	type RemoteAskCompletedEvent,
	type RemoteAskStartedEvent,
} from "../src/remote-ask.ts";
import { registerPendingAskResume } from "../src/resume-pending-ask.ts";
import type { AskParams } from "../src/types.ts";

const CANVAS_RE = /Canvas/;

const params: AskParams = {
	title: "Choose engine",
	questions: [
		{
			id: "engine",
			prompt: "Chart engine?",
			options: [
				{ value: "canvas", label: "Canvas" },
				{ value: "svg", label: "SVG" },
			],
		},
	],
};

class TestEventBus {
	readonly events: Array<{ channel: string; data: unknown }> = [];
	private readonly handlers = new Map<string, Array<(data: unknown) => void>>();

	emit(channel: string, data: unknown): void {
		this.events.push({ channel, data });
		for (const handler of this.handlers.get(channel) ?? []) {
			handler(data);
		}
	}

	on(channel: string, handler: (data: unknown) => void): () => void {
		const handlers = this.handlers.get(channel) ?? [];
		handlers.push(handler);
		this.handlers.set(channel, handlers);
		return () => {
			this.handlers.set(
				channel,
				(this.handlers.get(channel) ?? []).filter(
					(candidate) => candidate !== handler
				)
			);
		};
	}
}

function assistantMessage(content: unknown[], stopReason = "toolUse") {
	return {
		type: "message",
		message: { role: "assistant", content, stopReason },
	};
}

function askToolCall(id: string, argumentsValue: unknown = params) {
	return assistantMessage([
		{ type: "toolCall", id, name: "ask_user", arguments: argumentsValue },
	]);
}

function toolResult(toolCallId: string) {
	return {
		type: "message",
		message: { role: "toolResult", toolCallId, toolName: "ask_user" },
	};
}

function storedPayload(
	sourceEntryId: string,
	storedParams: unknown = params,
	version = 1
) {
	return {
		type: "custom",
		customType: "ask:payload",
		data: {
			version,
			source: "tool",
			params: storedParams,
			sourceEntryId,
			timestamp: 1,
		},
	};
}

function dismissed(toolCallId: string) {
	return {
		type: "custom",
		customType: ASK_PENDING_DISMISSED_ENTRY_TYPE,
		data: { toolCallId },
	};
}

function scannerContext(branch: unknown[]) {
	return { sessionManager: { getBranch: () => branch } } as never;
}

test("pending ask scan selects the newest unresolved valid ask_user call", () => {
	const pending = findPendingAskToolCall(
		scannerContext([
			askToolCall("call-1"),
			storedPayload("call-1"),
			askToolCall("call-2"),
			storedPayload("call-2"),
			toolResult("call-2"),
			askToolCall("call-3", { questions: [] }),
		])
	);

	assert.deepEqual(pending, { params, toolCallId: "call-1" });
});

test("pending ask scan prefers stored payload and validates original fallback", () => {
	const persisted = { ...params, title: "Persisted" };
	assert.equal(
		findPendingAskToolCall(
			scannerContext([
				askToolCall("call-1", { ...params, title: "Recorded" }),
				storedPayload("call-1", persisted),
			])
		)?.params,
		persisted
	);
	assert.deepEqual(
		findPendingAskToolCall(
			scannerContext([askToolCall("call-2"), storedPayload("call-2", {}, 99)])
		),
		{ params, toolCallId: "call-2" }
	);
	assert.equal(
		findPendingAskToolCall(scannerContext([askToolCall("call-3", {})])),
		undefined
	);
});

test("pending dismissal resolves automatic recovery but preserves manual replay", () => {
	const branch = [
		askToolCall("call-1"),
		storedPayload("call-1"),
		dismissed("call-1"),
	];
	assert.equal(findPendingAskToolCall(scannerContext(branch)), undefined);
	assert.equal(
		findLatestPayloadInCurrentBranch(scannerContext(branch), "tool").data
			?.params,
		params
	);
});

test("pending ask resume scans only startup, resume, and fork TUI events", () => {
	let sessionStartHandler: ((event: any, ctx: any) => void) | undefined;
	const remoteAsk = createRemoteAskRuntime(new TestEventBus() as never);
	registerPendingAskResume(
		{
			on(event: string, handler: (event: any, ctx: any) => void) {
				if (event === "session_start") {
					sessionStartHandler = handler;
				}
			},
		} as never,
		remoteAsk
	);
	assert(sessionStartHandler);

	const branchReads: string[] = [];
	for (const reason of ["startup", "resume", "fork", "new", "reload"]) {
		sessionStartHandler(
			{ type: "session_start", reason },
			{
				mode: "tui",
				sessionManager: {
					getBranch() {
						branchReads.push(reason);
						return [];
					},
				},
			}
		);
	}
	sessionStartHandler(
		{ type: "session_start", reason: "startup" },
		{
			mode: "rpc",
			sessionManager: {
				getBranch() {
					branchReads.push("rpc");
					return [];
				},
			},
		}
	);

	assert.deepEqual(branchReads, ["startup", "resume", "fork"]);
	remoteAsk.disposeAll();
});

test("resumed submit persists one dismissal and delivers a canonical answer", {
	timeout: 2000,
}, async () => {
	getAskConfigStore().setConfig(disabledNotificationConfig());
	const branch: unknown[] = [askToolCall("call-1"), storedPayload("call-1")];
	const bus = new TestEventBus();
	const remoteAsk = createRemoteAskRuntime(bus as never);
	let resolveDelivery: (() => void) | undefined;
	const delivery = new Promise<void>((resolve) => {
		resolveDelivery = resolve;
	});
	const harness = createResumeHarness(branch, remoteAsk, {
		idle: false,
		onSend: () => resolveDelivery?.(),
	});

	bus.on(PI_ASK_STARTED_EVENT, (data) => {
		const started = data as RemoteAskStartedEvent;
		bus.emit(PI_ASK_SUBMIT_EVENT, {
			version: 1,
			requestId: "submit-1",
			flowId: started.flowId,
			response: {
				kind: "answer",
				answers: { engine: { values: ["canvas"] } },
			},
		});
	});

	assert.equal(harness.start("resume"), undefined);
	await delivery;
	assert.deepEqual(harness.dismissedToolCallIds, ["call-1"]);
	assert.match(harness.sentMessages[0]?.text ?? "", CANVAS_RE);
	assert.deepEqual(harness.sentMessages[0]?.options, { deliverAs: "followUp" });
	assert.equal(
		findEvent<RemoteAskCompletedEvent>(bus, PI_ASK_COMPLETED_EVENT).source,
		"ask:resume"
	);

	remoteAsk.disposeAll();
	getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
});

test("resumed cancel persists one dismissal and does not reopen", {
	timeout: 2000,
}, async () => {
	getAskConfigStore().setConfig(disabledNotificationConfig());
	const branch: unknown[] = [askToolCall("call-1"), storedPayload("call-1")];
	const bus = new TestEventBus();
	const remoteAsk = createRemoteAskRuntime(bus as never);
	let resolveCancellation: (() => void) | undefined;
	const cancellation = new Promise<void>((resolve) => {
		resolveCancellation = resolve;
	});
	const harness = createResumeHarness(branch, remoteAsk, {
		onDismissNotice: () => resolveCancellation?.(),
	});

	bus.on(PI_ASK_STARTED_EVENT, (data) => {
		const started = data as RemoteAskStartedEvent;
		bus.emit(PI_ASK_SUBMIT_EVENT, {
			version: 1,
			requestId: "cancel-1",
			flowId: started.flowId,
			response: { kind: "cancel" },
		});
	});

	harness.start("startup");
	await cancellation;
	await new Promise<void>((resolve) => setImmediate(resolve));
	harness.start("resume");
	await new Promise<void>((resolve) => setImmediate(resolve));

	assert.deepEqual(harness.dismissedToolCallIds, ["call-1"]);
	assert.equal(harness.sentMessages.length, 0);
	assert.equal(
		bus.events.filter((event) => event.channel === PI_ASK_STARTED_EVENT).length,
		1
	);

	remoteAsk.disposeAll();
	getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
});

function createResumeHarness(
	branch: unknown[],
	remoteAsk: ReturnType<typeof createRemoteAskRuntime>,
	options: {
		idle?: boolean;
		onDismissNotice?: () => void;
		onSend?: (text: string, sendOptions: unknown) => void;
	} = {}
) {
	let sessionStartHandler: ((event: any, ctx: any) => void) | undefined;
	const dismissedToolCallIds: string[] = [];
	const sentMessages: Array<{ text: string; options: unknown }> = [];

	registerPendingAskResume(
		{
			on(event: string, handler: (event: any, ctx: any) => void) {
				if (event === "session_start") {
					sessionStartHandler = handler;
				}
			},
			appendEntry(customType: string, data: { toolCallId: string }) {
				branch.push({ type: "custom", customType, data });
				dismissedToolCallIds.push(data.toolCallId);
			},
			sendUserMessage(text: string, sendOptions: unknown) {
				sentMessages.push({ text, options: sendOptions });
				options.onSend?.(text, sendOptions);
			},
		} as never,
		remoteAsk
	);
	assert(sessionStartHandler);

	const ctx = {
		cwd: process.cwd(),
		isIdle: () => options.idle ?? true,
		mode: "tui",
		sessionManager: { getBranch: () => branch },
		ui: {
			custom(callback: (...args: any[]) => unknown) {
				return new Promise((resolve) => {
					callback(
						{
							requestRender() {
								// Rendering is not needed for this lifecycle test.
							},
						},
						plainTheme(),
						{},
						resolve
					);
				});
			},
			notify(message: string) {
				if (message.startsWith("Unanswered ask_user form dismissed")) {
					options.onDismissNotice?.();
				}
			},
			setWorkingVisible() {
				// The harness only checks lifecycle behavior.
			},
		},
	};

	return {
		dismissedToolCallIds,
		sentMessages,
		start(reason: "startup" | "resume" | "fork") {
			return sessionStartHandler?.({ type: "session_start", reason }, ctx);
		},
	};
}

function disabledNotificationConfig() {
	return {
		...DEFAULT_ASK_CONFIG,
		notifications: { ...DEFAULT_ASK_CONFIG.notifications, enabled: false },
	};
}

function findEvent<T>(bus: TestEventBus, channel: string): T {
	const event = bus.events.find((candidate) => candidate.channel === channel);
	assert(event);
	return event.data as T;
}

function plainTheme() {
	return {
		bg(_color: string, text: string) {
			return text;
		},
		fg(_color: string, text: string) {
			return text;
		},
	};
}
