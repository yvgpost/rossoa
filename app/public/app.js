function toggleDrawer() {
  const d = document.getElementById('drawer');
  const h = document.getElementById('hamburger');
  if (d.classList.contains('open')) {
    d.classList.remove('open');
    h.classList.remove('open');
  } else {
    d.classList.add('open');
    h.classList.add('open');
  }
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('hamburger').classList.remove('open');
}
