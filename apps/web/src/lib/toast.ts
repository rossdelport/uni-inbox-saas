// Tiny app-wide toast bus. Layout renders the .uni-toast element and listens.
export function toast(message: string) {
  document.dispatchEvent(new CustomEvent("uni:toast", { detail: message }));
}
