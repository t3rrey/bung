import { readFileSync } from "fs";
import type {
  Feature,
  Position as GeoPosition,
  LineString,
  Polygon,
} from "geojson";
import { Server, Socket } from "net";
import { type GGAPacket } from "nmea-simple";
import { networkInterfaces } from "os";
import * as readline from "readline";
import { createInterface } from "readline";

// Constants
export const PORT = 3006;
export const HOST = "0.0.0.0";
export const GPS_FIX_TYPE = "rtk";
export const GEOJSON_INPUT_PATH = "./geojson-data/input.geojson";
export const GGA_UPDATE_INTERVAL = 2000; // 2 seconds
export const BESTPOS_UPDATE_INTERVAL = 1000; // 1 second
export const UAL_OPERATIONAL = 0.08;
export const MAX_SPEED_FACTOR = 4.0;
export const MIN_SPEED_FACTOR = 0.25;

// Types
export interface Position {
  latitude: number;
  longitude: number;
  altitude: number;
  satellitesInView: number;
  horizontalDilution: number;
}

export interface CoordinateResult {
  coordinate: string;
  direction: string;
}

export interface BestPosData {
  solutionStatus: string;
  positionType: string;
  latitude: number;
  longitude: number;
  height: number;
  undulation: number;
  datumId: number;
  latitudeStdDev: number;
  longitudeStdDev: number;
  heightStdDev: number;
  stationId: string;
  differentialAge: number;
  solutionAge: number;
  numTrackedSatellites: number;
  numSolutionSatellites: number;
  numSolutionL1Satellites: number;
  numSolutionMultiSatellites: number;
  extendedSolutionStatus: number;
  galileoBeiDouSigMask: number;
  gpsGlonassSigMask: number;
}

interface ExtendedSocket extends Socket {
  _updateIntervals: () => void;
}

// Global state
let coordinates: GeoPosition[] = [];
let currentIndex = 0;
let paused = true;
let speedFactor = 1.0;
const connectedSockets: ExtendedSocket[] = [];

// GeoJSON handling
export function loadGeoJSON(filePath: string): void {
  try {
    const geojsonContent = readFileSync(filePath, "utf8");
    const feature: Feature = JSON.parse(geojsonContent);
    coordinates = [];

    if (feature.geometry.type === "LineString") {
      const lineString = feature.geometry as LineString;
      coordinates.push(...lineString.coordinates);
    } else if (feature.geometry.type === "Polygon") {
      const polygon = feature.geometry as Polygon;
      // For polygons, we use the outer ring (first array of coordinates)
      coordinates.push(...polygon.coordinates[0]);
    }

    console.log(`Loaded ${coordinates.length} coordinates from GeoJSON`);
  } catch (error) {
    console.error("Error loading GeoJSON:", error);
    throw error;
  }
}

export function getNextPosition(): Position {
  const [longitude, latitude] = coordinates[currentIndex] as [number, number];

  // Move to next coordinate, loop back to start if at end
  currentIndex = (currentIndex + 1) % coordinates.length;

  return {
    latitude,
    longitude,
    altitude: 10.0 + (Math.random() - 0.5) * 0.1,
    satellitesInView: Math.floor(Math.random() * 4) + 8,
    horizontalDilution: 1.0 + Math.random() * 0.4,
  };
}

// Coordinate formatting utilities
export function convertLatLongToDMS(
  coordinate: number,
  isLongitude: boolean
): CoordinateResult {
  const direction = isLongitude
    ? coordinate >= 0
      ? "E"
      : "W"
    : coordinate >= 0
    ? "N"
    : "S";

  coordinate = Math.abs(coordinate);
  const degrees = Math.floor(coordinate);
  const minutes = (coordinate - degrees) * 60;

  const degreesStr = isLongitude
    ? degrees.toString().padStart(3, "0")
    : degrees.toString().padStart(2, "0");

  const minutesStr = minutes.toFixed(8).padStart(11, "0");
  const formattedCoordinate = `${degreesStr}${minutesStr}`;

  return {
    coordinate: formattedCoordinate,
    direction,
  };
}

export function formatTime(date: Date): string {
  return (
    date.getUTCHours().toString().padStart(2, "0") +
    date.getUTCMinutes().toString().padStart(2, "0") +
    date.getUTCSeconds().toString().padStart(2, "0") +
    "." +
    date.getUTCMilliseconds().toString().padStart(3, "0")
  );
}

export function calculateChecksum(message: string): string {
  let checksum = 0;
  for (let i = 1; i < message.length; i++) {
    checksum ^= message.charCodeAt(i);
  }
  return checksum.toString(16).toUpperCase().padStart(2, "0");
}

// GPS data generation
export function getFakeGGAData(): GGAPacket {
  const position = getNextPosition();

  return {
    sentenceId: "GGA",
    time: new Date(),
    latitude: position.latitude,
    longitude: position.longitude,
    fixType: GPS_FIX_TYPE,
    satellitesInView: position.satellitesInView,
    horizontalDilution: position.horizontalDilution,
    altitudeMeters: 0,
    geoidalSeperation: 0,
    differentialAge: 1,
    differentialRefStn: "0000",
  };
}

export function getFakeBestPosData(position: Position): BestPosData {
  return {
    solutionStatus: "SOL_COMPUTED",
    positionType: "OPERATIONAL",
    latitude: position.latitude,
    longitude: position.longitude,
    height: 0,
    undulation: -17.0,
    datumId: 61, // WGS84
    latitudeStdDev: 0.0124,
    longitudeStdDev: 0.0084,
    heightStdDev: 0,
    stationId: "TSTR",
    differentialAge: 1.0,
    solutionAge: 0.0,
    numTrackedSatellites: position.satellitesInView,
    numSolutionSatellites: position.satellitesInView - 1,
    numSolutionL1Satellites: position.satellitesInView - 2,
    numSolutionMultiSatellites: position.satellitesInView - 3,
    extendedSolutionStatus: 0x11, // RTK verified and RTKASSIST active
    galileoBeiDouSigMask: 0x7f,
    gpsGlonassSigMask: 0x37,
  };
}

// Message formatting
export function formatGGAMessage(data: GGAPacket): string {
  const lat = convertLatLongToDMS(data.latitude, false);
  const lon = convertLatLongToDMS(data.longitude, true);

  const fields = [
    "$GPGGA",
    formatTime(data.time),
    lat.coordinate,
    lat.direction,
    lon.coordinate,
    lon.direction,
    "4", // RTK fixed solution
    data.satellitesInView.toString().padStart(2, "0"),
    data.horizontalDilution.toFixed(1),
    "0.0", // Altitude (2D mode)
    "M",
    "0.0", // Geoidal separation (2D mode)
    "M",
    "1", // Differential age for RTK
    "0000", // Reference station
  ];

  const message = fields.join(",");
  const checksum = calculateChecksum(message);
  return `${message}*${checksum}\r\n`;
}

export function formatBestPosMessage(data: BestPosData): string {
  const now = new Date();
  const gpsWeek = Math.floor(
    (now.getTime() - new Date("1980-01-06").getTime()) /
      (7 * 24 * 60 * 60 * 1000)
  );
  const gpsSeconds =
    now.getUTCHours() * 3600 +
    now.getUTCMinutes() * 60 +
    now.getUTCSeconds() +
    now.getUTCMilliseconds() / 1000;

  const fields = [
    "#BESTPOSA",
    "USB1",
    "0",
    "58.5",
    "FINESTEERING",
    gpsWeek.toString(),
    gpsSeconds.toFixed(3),
    "02000020",
    "cdba",
    "16809",
    data.solutionStatus,
    data.positionType,
    data.latitude.toFixed(11),
    data.longitude.toFixed(11),
    data.height.toFixed(4),
    data.undulation.toFixed(4),
    "WGS84",
    data.latitudeStdDev.toFixed(4),
    data.longitudeStdDev.toFixed(4),
    data.heightStdDev.toFixed(4),
    `"${data.stationId}"`,
    data.differentialAge.toFixed(3),
    data.solutionAge.toFixed(3),
    data.numTrackedSatellites,
    data.numSolutionSatellites,
    data.numSolutionL1Satellites,
    data.numSolutionMultiSatellites,
    "00",
    data.extendedSolutionStatus.toString(16).padStart(2, "0"),
    data.galileoBeiDouSigMask.toString(16).padStart(2, "0"),
    data.gpsGlonassSigMask.toString(16).padStart(2, "0"),
  ];

  const message = fields.join(",");
  const checksum = calculateChecksum(message);
  return `${message}*${checksum}\r\n`;
}

// UI utils
function clearAndShowStatus(message: string = ""): void {
  console.clear();
  console.log(`NMEA GGA simulator running on port ${PORT}`);
  console.log(`GeoJSON path: ${GEOJSON_INPUT_PATH}`);

  console.log(`\nStatus: ${paused ? "⏸️ PAUSED" : "▶️ PLAYING"}`);
  console.log(`Speed: ${speedFactor.toFixed(2)}x`);
  console.log(`Connected clients: ${connectedSockets.length}`);

  console.log("\n=== Interactive Commands ===");
  console.log("p - Play (start sending GPS data)");
  console.log("s - Stop (pause sending GPS data)");
  console.log("q - Quit the application");
  console.log("↑ - Speed up GPS data");
  console.log("↓ - Slow down GPS data");
  console.log("===========================\n");

  if (message) {
    console.log(`${message}\n`);
  }
}

// Socket handling
function handleSocketConnection(socket: Socket): void {
  console.log("Client connected");
  const extSocket = socket as ExtendedSocket;
  connectedSockets.push(extSocket);

  let ggaIntervalId: NodeJS.Timer;
  let bestposIntervalId: NodeJS.Timer;

  // Setup intervals for sending GPS data
  const updateIntervals = (): void => {
    clearInterval(ggaIntervalId);
    clearInterval(bestposIntervalId);

    ggaIntervalId = setInterval(() => {
      if (!paused) {
        const ggaData = getFakeGGAData();
        const message = formatGGAMessage(ggaData);
        console.log("Sending GGA:", message.trim());
        socket.write(message);
      }
    }, Math.round(GGA_UPDATE_INTERVAL / speedFactor));

    bestposIntervalId = setInterval(() => {
      if (!paused) {
        const position = getNextPosition();
        const bestPosData = getFakeBestPosData(position);
        const bestPosMessage = formatBestPosMessage(bestPosData);
        console.log("Sending BESTPOS:", bestPosMessage.trim());
        socket.write(bestPosMessage);
      }
    }, Math.round(BESTPOS_UPDATE_INTERVAL / speedFactor));
  };

  extSocket._updateIntervals = updateIntervals;
  updateIntervals();

  // Handle client commands
  socket.on("data", (data: Buffer): void => {
    const command = data.toString().trim().toLowerCase();

    if (connectedSockets.length > 0) {
      clearAndShowStatus(`Received command from client: ${command}`);
    }

    if (command === "pause") {
      paused = true;
      socket.write("ACK: Stream paused\r\n");
    } else if (command === "play") {
      paused = false;
      socket.write("ACK: Stream resumed\r\n");
    } else {
      socket.write("ACK: Unknown command\r\n");
    }
  });

  // Handle socket disconnection
  socket.on("close", (): void => {
    console.log("Client disconnected");
    clearInterval(ggaIntervalId);
    clearInterval(bestposIntervalId);

    const index = connectedSockets.indexOf(extSocket);
    if (index !== -1) {
      connectedSockets.splice(index, 1);
    }
  });

  socket.on("error", (err: Error): void => {
    console.error("Socket error:", err.message);
    clearInterval(ggaIntervalId);
    clearInterval(bestposIntervalId);
  });
}

// Update all client intervals when speed changes
function updateAllClientIntervals(): void {
  if (connectedSockets.length > 0) {
    connectedSockets.forEach((socket) => {
      if (socket._updateIntervals) {
        socket._updateIntervals();
      }
    });
  }
}

// Interactive UI handling
function setupInteractiveUI(server: Server): void {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
  });

  // Enable keypress events
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  const localClearAndShowStatus = (message: string): void => {
    clearAndShowStatus(message);
    rl.prompt();
  };

  // Handle keypress events
  process.stdin.on("keypress", (str, key): void => {
    if (key.name === "up") {
      speedFactor = Math.min(speedFactor * 1.25, MAX_SPEED_FACTOR);
      updateAllClientIntervals();
      localClearAndShowStatus(`Speed increased to ${speedFactor.toFixed(2)}x`);
    } else if (key.name === "down") {
      speedFactor = Math.max(speedFactor * 0.8, MIN_SPEED_FACTOR);
      updateAllClientIntervals();
      localClearAndShowStatus(`Speed decreased to ${speedFactor.toFixed(2)}x`);
    } else if (str === "p") {
      paused = false;
      localClearAndShowStatus("Stream started");
    } else if (str === "s") {
      paused = true;
      localClearAndShowStatus("Stream paused");
    } else if (str === "q") {
      console.clear();
      console.log("Shutting down server...");
      server.close();
      process.exit(0);
    } else if (key.ctrl && key.name === "c") {
      console.clear();
      console.log("Exiting FGPS simulator");
      process.exit();
    } else {
      localClearAndShowStatus("");
    }
  });

  // Initial status display
  localClearAndShowStatus("System ready");

  // Handle empty lines
  rl.on("line", (): void => {
    localClearAndShowStatus("");
  }).on("close", (): void => {
    console.log("Exiting FGPS simulator");
    process.exit(0);
  });
}

// Display available network interfaces
function displayNetworkInterfaces(): void {
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    const interfaces = nets[name];
    if (interfaces) {
      for (const net of interfaces) {
        if (!net.internal && net.family === "IPv4") {
          console.log(`  ${net.address}:${PORT}`);
        }
      }
    }
  }
}

// Main function
function main(): void {
  // Load coordinates from GeoJSON file
  loadGeoJSON(GEOJSON_INPUT_PATH);

  // Create and configure TCP server
  const server = new Server();

  server.on("connection", handleSocketConnection);

  server.on("error", (err: Error): void => {
    console.error("Server error:", err.message);
  });

  // Start the server
  server.listen(PORT, HOST, (): void => {
    console.log(`NMEA GGA simulator running on port ${PORT}`);
    console.log(`GeoJSON path: ${GEOJSON_INPUT_PATH}`);

    displayNetworkInterfaces();

    // Set up interactive command interface
    setupInteractiveUI(server);
  });
}

// Start the application only when this file is directly executed (not imported)
// if (import.meta.url === Bun.main) {
//   main();
// }

main();
