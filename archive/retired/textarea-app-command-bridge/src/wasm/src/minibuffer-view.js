export function minibufferTextForPrefix(prefix) {
  return typeof prefix === "string" && prefix.length > 0 ? prefix : "";
}

export function minibufferTextForWorkerError(text) {
  if (typeof text !== "string") return "";
  if (text.includes("minibuffer requires persistent Emacs command loop")) {
    return "minibuffer unavailable: persistent command loop, window state, completion UI";
  }
  if (text.includes("clipboard/kill-ring requires GUI clipboard protocol")) {
    return "clipboard unavailable: GUI clipboard protocol and persistent region state required";
  }
  if (text.includes("host.process")) {
    return "process unavailable";
  }
  return "";
}
