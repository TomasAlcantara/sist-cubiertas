/**
 * Los tests corren en UTC, igual que el runtime de Vercel. Los bugs de fecha de
 * este sistema no se ven en la máquina del desarrollador (que está en horario
 * argentino): aparecen recién en producción, tres horas adelantada.
 *
 * Tiene que ser globalSetup y no un setupFile: para cuando corre un setupFile,
 * el entorno de Jest ya tiene cacheada la zona horaria del proceso.
 */
module.exports = () => { process.env.TZ = 'UTC'; };
