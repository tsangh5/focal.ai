const PAYMENT_AUTOCOMPLETE = /\bcc-(number|csc|exp|exp-month|exp-year|name|type)\b/;
const PAYMENT_NAME = /(card.?number|cardnum|ccnum|cc-?num|cvc|cvv|security.?code|iban|routing.?number|account.?number)/i;
const PAYMENT_FRAME = /(js\.stripe\.com|checkout\.stripe\.com|braintreegateway\.com|adyen\.com|checkout\.com|paypal\.com|squareup\.com|recurly\.com)/i;

/** False for fields the user can't see, like a closed sign-in dialog. */
function rendered(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true });
  const view = el.ownerDocument.defaultView;
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute("hidden")) return false;
    const style = view?.getComputedStyle(n);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  }
  return true;
}

/** A payment provider's frame the user can see; hidden and zero-size frames don't count. */
function paymentFrame(frame: HTMLIFrameElement): boolean {
  let host: string;
  try {
    // Resolve against the page so relative and protocol-relative srcs work.
    host = new URL(frame.getAttribute("src") ?? "", location.href).hostname;
  } catch {
    return false;
  }
  if (!PAYMENT_FRAME.test(host)) return false;
  const box = frame.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && rendered(frame);
}

/** True when the page shows a password field or has a payment field (§5.1). */
export function hasSensitiveField(root: ParentNode): boolean {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="password" i]')) {
    if (rendered(input)) return true;
  }
  for (const input of root.querySelectorAll<HTMLInputElement>("input, select")) {
    const ac = input.getAttribute("autocomplete") ?? "";
    if (PAYMENT_AUTOCOMPLETE.test(ac)) return true;
    if ((ac.includes("current-password") || ac.includes("new-password")) && rendered(input)) return true;
    const key = `${input.getAttribute("name") ?? ""} ${input.id} ${input.getAttribute("data-elements-stable-field-name") ?? ""}`;
    if (PAYMENT_NAME.test(key)) return true;
  }
  for (const frame of root.querySelectorAll<HTMLIFrameElement>("iframe[src]")) {
    if (paymentFrame(frame)) return true;
  }
  return false;
}
