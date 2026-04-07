var global_dir = "/";

function show_rlist(dir, pos) {
  global_dir = dir;
  document.getElementById('back').style.display = '';
  document.getElementById('filter_list').style.display = '';
  document.getElementById('pos').value = pos;
  filtrar();
}

function close_rlist() {
  document.getElementById('back').style.display = 'none';
  document.getElementById('filter_list').style.display = 'none';
}

function filtrar() {
  $.ajax({
    type: 'POST',
    url: global_dir + 'ajax/listar_ruedas',
    data: $('#formulario').serialize(),
    success: function(data) {
      if (data) document.getElementById('rueda_list').innerHTML = data;
    }
  });
}

function colocar(id, unidad, pos) {
  $.ajax({
    type: 'POST',
    url: global_dir + 'ajax/colocar_rueda',
    data: { id: id, unidad: unidad, pos: pos },
    success: function(data) {
      if (data === 'OK' || data === '0' || data === 0) {
        location.reload();
      } else {
        document.getElementById('back2').style.display = '';
        document.getElementById('rueda_removida').style.display = '';
        document.getElementById('r_id_selected').value = data;
      }
    }
  });
}

function almacenar() {
  if (!document.getElementById('almacen_id').value) {
    alert('Debe seleccionar el almacén');
    return;
  }
  $.ajax({
    type: 'POST',
    url: global_dir + 'ajax/almacenar_rueda',
    data: {
      r_id: document.getElementById('r_id_selected').value,
      almacen_id: document.getElementById('almacen_id').value
    },
    success: function() { location.reload(); }
  });
}
