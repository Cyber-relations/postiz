/* Only navigation state is enhanced; all information is readable without JS. */
(() => {
  const floating = document.querySelector('.detail-floating-cta');
  const index = document.getElementById('security-index');
  const contact = document.getElementById('security-contact');
  const dataLocation = document.getElementById('security-location');
  const footer = document.getElementById('site-footer');
  const dialog = document.getElementById('preview-dialog');
  if (!floating || !index || !contact || !footer) return;
  let queued = false;
  const update = () => {
    queued = false;
    // Preserve keyboard focus while the viewport moves to another section.
    if (floating.contains(document.activeElement)) return;
    const indexPassed = index.getBoundingClientRect().bottom < 100;
    const visible = element => {
      const bounds = element.getBoundingClientRect();
      return bounds.top < window.innerHeight && bounds.bottom > 100;
    };
    const contactVisible = visible(contact);
    const footerVisible = visible(footer);
    // Keep the diagram and its data-handling conditions unobstructed.
    const locationVisible = dataLocation && visible(dataLocation);
    floating.hidden = !indexPassed || locationVisible || contactVisible || footerVisible || !!dialog?.open;
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  // Anchor jumps can skip the index without crossing an observer threshold.
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  floating.addEventListener('focusout', schedule);
  document.addEventListener('click', schedule);
  document.addEventListener('toggle', schedule, true);
  dialog?.addEventListener('close', schedule);
  schedule();
})();
