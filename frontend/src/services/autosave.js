
export function scheduleSave(callback, delay = 600) {
  return setTimeout(callback, delay);
}

export function cancelScheduledSave(timer) {
  if (timer) {
    clearTimeout(timer);
  }
}
