const path = require('path')
const os = require('os')
const { app } = require('electron')

/**
 * 目录布局：
 *  - 基础游戏目录（共享）：Windows %APPDATA%\.minecraft ；Linux ~/.minecraft
 *      versions/  libraries/  assets/   ← 所有版本共享
 *  - 实例目录（版本隔离）：userData/instances/<id>/
 *      instance.json  saves/ mods/ config/ ...   ← 每个实例独立游戏目录
 *  - 启动器数据：userData/
 *      settings.json accounts.json java/<major>/ logs/
 */
function userData() {
  return app.getPath('userData')
}

function baseGameDir() {
  if (process.platform === 'win32') return path.join(app.getPath('appData'), '.minecraft')
  return path.join(os.homedir(), '.minecraft')
}

const p = {
  userData,
  baseGameDir,
  settingsFile: () => path.join(userData(), 'settings.json'),
  accountsFile: () => path.join(userData(), 'accounts.json'),
  versionsDir: () => path.join(baseGameDir(), 'versions'),
  librariesDir: () => path.join(baseGameDir(), 'libraries'),
  assetsDir: () => path.join(baseGameDir(), 'assets'),
  assetsIndexesDir: () => path.join(p.assetsDir(), 'indexes'),
  assetsObjectsDir: () => path.join(p.assetsDir(), 'objects'),
  resourcesDir: () => path.join(baseGameDir(), 'resources'), // 老版本 map_to_resources
  instancesDir: () => path.join(userData(), 'instances'),
  javaDir: () => path.join(userData(), 'java'),
  logsDir: () => path.join(userData(), 'logs'),
  versionDir: (id) => path.join(p.versionsDir(), id),
  versionJson: (id) => path.join(p.versionsDir(), id, id + '.json'),
  versionJar: (id) => path.join(p.versionsDir(), id, id + '.jar'),
  instanceDir: (id) => path.join(p.instancesDir(), id),
}

module.exports = p
