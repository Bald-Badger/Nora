const panel = document.querySelector('#inventory-panel');
const scrim = document.querySelector('#scrim');
const openButton = document.querySelector('#inventory-open');
const closeButton = document.querySelector('#inventory-close');
const form = document.querySelector('#chat-form');
const status = document.querySelector('#status');

function setInventoryOpen(isOpen) {
  panel.classList.toggle('open', isOpen);
  panel.setAttribute('aria-hidden', String(!isOpen));
  openButton.setAttribute('aria-expanded', String(isOpen));
  scrim.hidden = !isOpen;

  if (isOpen) {
    closeButton.focus();
  } else {
    openButton.focus();
  }
}

openButton.addEventListener('click', () => setInventoryOpen(true));
closeButton.addEventListener('click', () => setInventoryOpen(false));
scrim.addEventListener('click', () => setInventoryOpen(false));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && panel.classList.contains('open')) {
    setInventoryOpen(false);
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  status.textContent = 'Static preview only - chat is not connected yet';
});
