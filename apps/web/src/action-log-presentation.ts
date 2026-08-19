import type {
  ActionLogItemProjection,
  CommandCueProjection,
} from "../../../packages/experience/src/index.js";

const renderedActionLogs = new WeakMap<object, string>();

function actionLogRenderKey(
  actionLog: readonly ActionLogItemProjection[],
  activeCommand: CommandCueProjection | undefined,
): string {
  const activeKey =
    activeCommand?.phase === "requested"
      ? `${activeCommand.requestId}\u0000${activeCommand.correlationId}\u0000${activeCommand.command}\u0000${activeCommand.throughSequence}`
      : "";
  const historyKey = actionLog
    .map(
      (item) =>
        `${item.requestId}\u0000${item.correlationId}\u0000${item.command}\u0000${item.throughSequence}`,
    )
    .join("\u0001");
  return `${activeKey}\u0002${historyKey}`;
}

export function applyActionLogPresentation(
  actionLog: readonly ActionLogItemProjection[],
  activeCommand: CommandCueProjection | undefined,
  element: HTMLOListElement,
): void {
  const renderKey = actionLogRenderKey(actionLog, activeCommand);
  if (renderedActionLogs.get(element) === renderKey) return;

  const pending =
    activeCommand?.phase === "requested" ? [activeCommand] : ([] as const);
  const rows = [...pending, ...actionLog].map((item, index) => {
    const requested = index < pending.length;
    const row = element.ownerDocument.createElement("li");
    row.className = "action-log__item";
    row.dataset.state = requested ? "requested" : "committed";
    row.setAttribute("role", "listitem");

    const command = element.ownerDocument.createElement("span");
    command.className = "action-log__command";
    command.textContent = item.command;
    row.append(command);
    return row;
  });

  element.replaceChildren(...rows);
  element.hidden = rows.length === 0;
  element.scrollTop = 0;
  renderedActionLogs.set(element, renderKey);
}
