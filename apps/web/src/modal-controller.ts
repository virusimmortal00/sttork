export interface ModalControllerOptions {
  readonly dialog: HTMLDialogElement;
  readonly trigger: HTMLButtonElement;
  readonly closeButton: HTMLButtonElement;
  readonly reducedMotion: () => boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

export interface ModalController {
  readonly open: () => void;
  readonly close: () => void;
}

export function createModalController(
  options: ModalControllerOptions,
): ModalController {
  let closeTimer: number | undefined;

  const notify = (open: boolean): void => options.onOpenChange?.(open);

  const finishClose = (): void => {
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    options.dialog.classList.remove("is-closing");
    if (options.dialog.open) options.dialog.close();
    options.trigger.setAttribute("aria-expanded", "false");
    options.trigger.focus();
    notify(false);
  };

  const close = (): void => {
    if (
      !options.dialog.open ||
      options.dialog.classList.contains("is-closing")
    ) {
      return;
    }
    if (options.reducedMotion()) {
      finishClose();
      return;
    }
    options.dialog.classList.add("is-closing");
    closeTimer = window.setTimeout(finishClose, 240);
  };

  const open = (): void => {
    if (options.dialog.open) return;
    options.dialog.showModal();
    options.trigger.setAttribute("aria-expanded", "true");
    options.closeButton.focus();
    notify(true);
  };

  options.trigger.addEventListener("click", () => {
    if (options.dialog.open) close();
    else open();
  });
  options.closeButton.addEventListener("click", close);
  options.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  options.dialog.addEventListener("click", (event) => {
    if (event.target === options.dialog) close();
  });
  options.dialog.addEventListener("transitionend", (event) => {
    if (
      event.target === options.dialog &&
      event.propertyName === "opacity" &&
      options.dialog.classList.contains("is-closing")
    ) {
      finishClose();
    }
  });

  return { open, close };
}
