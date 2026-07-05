function solo_activos(obj) {
  var active = obj.checked ? 1 : 0;
  $.ajax({
    type: 'POST',
    url: '/ajax/change_filter',
    data: { activo: active },
    success: function() { location.reload(); }
  });
}

function active(id, active, table) {
  $.ajax({
    type: 'POST',
    url: '/ajax/inactive',
    data: { id: id, active: active, table: table },
    success: function() { location.reload(); }
  });
}

/* ─── Modern UI Scripts (UX/UI Upgrade) ────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Mobile Menu Toggle
  const mobileToggle = document.querySelector('.mobile-toggle');
  const navMenu = document.querySelector('.nav-menu');
  const navOverlay = document.querySelector('.nav-overlay');

  if (mobileToggle && navMenu && navOverlay) {
    mobileToggle.addEventListener('click', () => {
      navMenu.classList.toggle('open');
      navOverlay.classList.toggle('open');
    });
    navOverlay.addEventListener('click', () => {
      navMenu.classList.remove('open');
      navOverlay.classList.remove('open');
    });
  }

  // Auto-init TomSelect on generic .search-select elements if any
  if (typeof TomSelect !== 'undefined') {
    document.querySelectorAll('.search-select').forEach((el) => {
      new TomSelect(el, { create: false, sortField: { field: "text", direction: "asc" } });
    });
  }
});

/**
 * Función global para lanzar notificaciones de sistema (reemplaza alertas invasivas)
 * @param {string} msg Mensaje a mostrar
 * @param {string} type 'success' | 'error' | 'info'
 */
function showToast(msg, type = 'info') {
  if (typeof Toastify === 'undefined') {
    alert(msg); // Fallback
    return;
  }
  let bgColors = {
    'error': 'linear-gradient(to right, #c0392b, #e74c3c)',
    'success': 'linear-gradient(to right, #2e7d32, #4caf50)',
    'info': 'linear-gradient(to right, #4a4a4a, #8a8a8a)'
  };
  Toastify({
    text: msg,
    duration: 3000,
    close: true,
    gravity: "bottom",
    position: "right",
    stopOnFocus: true,
    style: {
      background: bgColors[type] || bgColors['info'],
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: "12px",
      borderRadius: "5px"
    }
  }).showToast();
}
