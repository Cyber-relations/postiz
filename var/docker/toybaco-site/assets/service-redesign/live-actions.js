// toybaco_staging_site_v1: consultation preview sends no messages.
function openChat() {
  document.getElementById('toybaco-staging-chat-preview').showModal();
}
document.addEventListener('click', event => {
 const control=event.target.closest('[data-open-chat]');
 if(control){event.preventDefault();openChat(control.getAttribute('href'));}
});
