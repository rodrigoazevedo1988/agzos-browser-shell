// Entrada do bundle do motor de filtros. O `desktop:build` gera
// electron/adblocker.vendor.cjs (sem node_modules), que vai no app.
module.exports = require("@ghostery/adblocker");
