// Tiny app-wide toast bus. Layout renders the toast card and listens.
export type ToastKind = "success" | "danger" | "warn" | "info";

export function toast(message: string, kind: ToastKind = "info") {
  document.dispatchEvent(new CustomEvent("uni:toast", { detail: { message, kind } }));
}
