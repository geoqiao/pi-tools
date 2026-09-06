import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { UI_DIMENSIONS } from "./constants/ui.ts";
import { renderResultText } from "./result.ts";
import { createInitialState } from "./state/create.ts";
import { collectValidationIssues } from "./state/normalize.ts";
import { summarizeResult, toAskResult } from "./state/result.ts";
import type {
	AskParams,
	AskQuestionInput,
	AskResult,
	AskValidationIssue,
} from "./types.ts";

export const ASK_TOOL_DESCRIPTION =
	"Interactive clarification after reading context: ask only for unresolved critical requirements, outcome-changing preferences, or consequential/hard-to-reverse actions beyond existing authorization; also for explicitly requested interviews, requirements gathering, or interactive questions. Multiple options alone do not justify asking. TUI supports single-select, multi-select, and preview-pane questions; RPC asks sequentially with one choice or typed input, flattening previews into option text. Include a stable `id` and non-empty `prompt` for each question, plus a non-empty machine-readable `value` and visible `label` for each option. Use `preview` only when every option has non-empty `preview` text; descriptions alone do not suffice.";

export const ASK_TOOL_PROMPT_GUIDELINES = [
	"Before `ask_user`, read available context: code, docs, conversation, and prior answers. Ask only if a critical requirement or outcome-changing preference remains unresolved, or a consequential or hard-to-reverse action exceeds existing authorization.",
	"Use `ask_user` for explicitly requested interviews, requirements gathering, or interactive questions. Multiple options or architecture/naming/research labels alone do not justify asking; analyze clear comparison/research requests first.",
	"Do not use `ask_user` to reconfirm settled choices or authorization. Proceed with authorized reversible steps and routine implementation details; state useful assumptions.",
	"With `ask_user`, delegated autonomy does not waive safety boundaries. Cancellation, missing answers, or ambiguity are not high-risk approval; keep unauthorized high-risk actions blocked.",
	"In `ask_user`, ask only current blockers (or the requested interview topic), one decision per question; bundle independent related questions. Answer elaboration notes first; re-ask only remaining blockers. Reopen settled decisions only for materially new information.",
	"For `ask_user`, include a stable `id` and non-empty `prompt` for each question, and a non-empty machine-readable `value` and visible `label` for each option. Keep labels short and options distinct; no filler.",
	"For `ask_user`, mark grounded preferences with `recommended: true` and explain the reason in `description`; recommendations are not preselected.",
	"For `ask_user`, use `single` for one answer, `multi` for multiple possible selections, and `preview` only when every option has non-empty `preview` text; descriptions alone do not suffice.",
	"For `ask_user` in RPC, questions are sequential with one choice or `Type something…` (including typed multiple choices); previews flatten into option text. Do not promise same-screen forms, native checkbox cards, or a custom preview pane.",
] as const;

interface ValidateParamsOptions {
	allowFreeform?: boolean;
	presentSingleAsMulti?: boolean;
}

export function validateParams(
	params: AskParams,
	options: ValidateParamsOptions = {}
):
	| { ok: true; state: ReturnType<typeof createInitialState> }
	| { ok: false; issues: AskValidationIssue[] } {
	const issues = collectValidationIssues(params, options);
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	return {
		ok: true,
		state: createInitialState(params, options),
	};
}

export function invalidPayloadResponse(
	params: AskParams,
	issues: AskValidationIssue[]
) {
	return {
		content: [{ type: "text" as const, text: formatValidationError(issues) }],
		details: errorResultDetails(params, issues),
	};
}

export function nonInteractiveResponse(
	state: ReturnType<typeof createInitialState>
) {
	return {
		content: [
			{ type: "text" as const, text: formatNonInteractiveMessage(state) },
		],
		details: {
			...toAskResult(state),
			cancelled: true,
		},
	};
}

export function successfulResponse(result: AskResult) {
	return {
		content: [{ type: "text" as const, text: summarizeResult(result) }],
		details: result,
	};
}

type ToolTheme = ExtensionContext["ui"]["theme"];

export function renderAskToolCall(args: unknown, theme: ToolTheme) {
	const params = args as AskParams;
	const labels = Array.isArray(params.questions)
		? params.questions
				.map(
					(question: AskQuestionInput, index) =>
						question.label?.trim() || `Q${index + 1}`
				)
				.join(", ")
		: "";
	let text = theme.fg("toolTitle", theme.bold("ask_user "));
	text += theme.fg("muted", `${params.questions?.length ?? 0} question(s)`);
	if (labels) {
		text += theme.fg(
			"dim",
			` (${truncateToWidth(labels, UI_DIMENSIONS.callLabelTruncateWidth)})`
		);
	}
	return new Text(text, 0, 0);
}

export function renderAskToolResult(
	result: {
		content: Array<{ type?: string; text?: string }>;
		details?: AskResult;
	},
	_options: unknown,
	theme: ToolTheme
) {
	const details = result.details;
	if (!(details && Array.isArray(details.questions))) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? (text.text ?? "") : "", 0, 0);
	}
	const text = renderResultText(details);
	return new Text(
		details.error || details.cancelled ? theme.fg("warning", text) : text,
		0,
		0
	);
}

function errorResultDetails(
	params: AskParams,
	issues: AskValidationIssue[]
): AskResult {
	return {
		title: params.title,
		cancelled: true,
		mode: "submit",
		questions: [],
		answers: {},
		error: {
			kind: "invalid_input",
			issues,
		},
	};
}

function formatValidationError(issues: AskValidationIssue[]): string {
	return [
		"Invalid ask_user payload:",
		...issues.map((issue) => `- ${issue.path}: ${issue.message}`),
	].join("\n");
}

function formatNonInteractiveMessage(
	state: ReturnType<typeof createInitialState>
): string {
	const lines = [
		"Needs user input: ask_user requires interactive TUI mode.",
		"Run same tool call in interactive TUI mode, or ask user these questions manually:",
	];

	for (const [index, question] of state.questions.entries()) {
		lines.push(`${index + 1}. ${question.label}: ${question.prompt}`);
		for (const option of question.options) {
			lines.push(`   - ${option.label} [${option.value}]`);
		}
		lines.push("   - Type your own [custom]");
	}

	lines.push(
		"details.questions contains normalized pending questions. details.answers stays empty until user responds."
	);
	return lines.join("\n");
}
