const DONE_KEY = "oneinbox-onboarding-done";

export function onboardingSeen(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Private browsing can deny storage; finishing the wizard still works.
  }
}
