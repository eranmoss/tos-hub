const log = (level, event, extra = {}) =>
  console.log(JSON.stringify({ level, event, ...extra }));

export const sendEmail = async ({ to, subject, html, text }) => {
  if (!process.env.RESEND_API_KEY || process.env.NODE_ENV === 'test') {
    log('info', 'notify_stub', { to, subject });
    return { id: 'stub_' + Date.now() };
  }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  return resend.emails.send({
    from: 'TOS Hub <noreply@tos.dev>',
    to, subject, html, text,
  });
};
