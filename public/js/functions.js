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
