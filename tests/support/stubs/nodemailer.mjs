// Stands in for nodemailer under `node --test`: records each message instead of sending it.
// Tests read globalThis.__mail.sent and set globalThis.__mail.fail = true to make sends throw.
const box = (globalThis.__mail ??= { sent: [], fail: false, transports: [] });

export function createTransport(options) {
  box.transports.push(options);
  return {
    async sendMail(message) {
      if (box.fail) throw new Error("stub: SMTP refused the message");
      box.sent.push(message);
      return { messageId: `<stub-${box.sent.length}@test>` };
    },
  };
}

const nodemailer = { createTransport };
export default nodemailer;
