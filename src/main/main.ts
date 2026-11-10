import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu, shell } from "electron";
import { initLogger, writeLog } from "./logger";
import { registerIpc } from "./ipc";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function getWindowIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "build", "icon.ico");
  }

  return path.join(app.getAppPath(), "build", "icon.ico");
}

function createWindow(): void {
  const iconPath = getWindowIconPath();
  if (fs.existsSync(iconPath)) {
    writeLog("info", `Application icon configured: ${iconPath}`);
  } else {
    writeLog("warn", `Application icon missing: ${iconPath}`);
  }

  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    title: "HyperDeck Media Puller",
    icon: iconPath,
    backgroundColor: "#111418",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  registerIpc(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  initLogger();
  Menu.setApplicationMenu(null);
  writeLog("info", "HyperDeck Media Puller started.");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
