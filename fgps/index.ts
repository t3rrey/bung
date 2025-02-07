import { readFileSync } from "fs";
import type {
  Feature,
  Position as GeoPosition,
  LineString,
  Polygon,
} from "geojson";
import { Server, Socket } from "net";
import { type GGAPacket } from "nmea-simple";

interface Position {
  latitude: number;
  longitude: number;
  altitude: number;
  satellitesInView: number;
  horizontalDilution: number;
}

interface CoordinateResult {
  coordinate: string;
  direction: string;
}

interface BestPosData {
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

const PORT = 3006;
const HOST = "0.0.0.0";
const GPS_FIX_TYPE = "rtk";
const GEOJSON_INPUT_PATH = "./test3.geojson";
const GGA_UPDATE_INTERVAL = 2000; // 2 seconds
const BESTPOS_UPDATE_INTERVAL = 1000; // 1 second
const UAL_OPERATIONAL = 0.08;

// Global state for coordinate tracking
let coordinates: GeoPosition[] = [];
let currentIndex = 0;

// server state
let paused = true;

function loadGeoJSON(filePath: string): void {
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

function getNextPosition(): Position {
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

function convertLatLongToDMS(
  coordinate: number,
  isLongitude: boolean
): CoordinateResult {
  // Determine direction
  let direction: string;
  if (isLongitude) {
    direction = coordinate >= 0 ? "E" : "W";
  } else {
    direction = coordinate >= 0 ? "N" : "S";
  }

  // Convert to absolute value for calculation
  coordinate = Math.abs(coordinate);

  // Extract degrees (everything before decimal)
  const degrees = Math.floor(coordinate);

  // Convert decimal degrees to minutes
  const minutes = (coordinate - degrees) * 60;

  // Format degrees to ensure proper width (2 digits for lat, 3 for long)
  const degreesStr = isLongitude
    ? degrees.toString().padStart(3, "0")
    : degrees.toString().padStart(2, "0");

  // Format minutes to 8 decimal places for high precision
  const minutesStr = minutes.toFixed(8).padStart(11, "0");

  // Combine degrees and minutes
  const formattedCoordinate = `${degreesStr}${minutesStr}`;

  return {
    coordinate: formattedCoordinate,
    direction,
  };
}

function formatTime(date: Date): string {
  return (
    date.getUTCHours().toString().padStart(2, "0") +
    date.getUTCMinutes().toString().padStart(2, "0") +
    date.getUTCSeconds().toString().padStart(2, "0") +
    "." +
    date.getUTCMilliseconds().toString().padStart(3, "0")
  );
}

function calculateChecksum(message: string): string {
  let checksum = 0;
  for (let i = 1; i < message.length; i++) {
    checksum ^= message.charCodeAt(i);
  }
  return checksum.toString(16).toUpperCase().padStart(2, "0");
}

function getFakeGGAData(): GGAPacket {
  const position = getNextPosition();

  return {
    sentenceId: "GGA",
    time: new Date(),
    latitude: position.latitude,
    longitude: position.longitude,
    fixType: GPS_FIX_TYPE, // Always RTK mode
    satellitesInView: position.satellitesInView,
    horizontalDilution: position.horizontalDilution,
    altitudeMeters: 0, // Set to 0 due to pos2d mode
    geoidalSeperation: 0, // Set to 0 due to pos2d mode
    differentialAge: 1, // Added for RTK mode
    differentialRefStn: "0000", // Added for RTK mode
  };
}

function getFakeBestPosData(position: Position): BestPosData {
  // Calculate position standard deviation based on UAL thresholds
  const stdDev = Math.random() * UAL_OPERATIONAL; // Usually within operational limits

  return {
    solutionStatus: "SOL_COMPUTED",
    positionType: "OPERATIONAL", // Using UAL operational status
    latitude: position.latitude,
    longitude: position.longitude,
    height: 0, // Set to 0 due to pos2d mode
    undulation: -17.0,
    datumId: 61, // WGS84
    latitudeStdDev: 0.0124,
    longitudeStdDev: 0.0084,
    heightStdDev: 0, // Zero due to pos2d mode
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

function formatGGAMessage(data: GGAPacket): string {
  const lat = convertLatLongToDMS(data.latitude, false);
  const lon = convertLatLongToDMS(data.longitude, true);

  const fields = [
    "$GPGGA",
    formatTime(data.time),
    lat.coordinate,
    lat.direction,
    lon.coordinate,
    lon.direction,
    "4", // Changed to 4 for RTK fixed solution
    data.satellitesInView.toString().padStart(2, "0"),
    data.horizontalDilution.toFixed(1),
    "0.0", // Altitude always 0 in 2D mode
    "M",
    "0.0", // Geoidal separation always 0 in 2D mode
    "M",
    "1", // Differential age for RTK
    "0000", // Reference station
  ];

  const message = fields.join(",");
  const checksum = calculateChecksum(message);
  return `${message}*${checksum}\r\n`;
}

function formatBestPosMessage(data: BestPosData): string {
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

// Load coordinates at startup
loadGeoJSON(GEOJSON_INPUT_PATH);

// Create TCP server
const server = new Server();

// Handle client connections
server.on("connection", (socket: Socket) => {
  console.log("Client connected");

  // A flag that tells whether the message stream is paused.

  const ggaIntervalId = setInterval(() => {
    if (!paused) {
      const ggaData = getFakeGGAData();
      const message = formatGGAMessage(ggaData);
      console.log("Sending GGA:", message.trim());
      socket.write(message);
    }
  }, GGA_UPDATE_INTERVAL);

  const bestposIntervalId = setInterval(() => {
    if (!paused) {
      const position = getNextPosition();
      const bestPosData = getFakeBestPosData(position);
      const bestPosMessage = formatBestPosMessage(bestPosData);
      console.log("Sending BESTPOS:", bestPosMessage.trim());
      socket.write(bestPosMessage);
    }
  }, BESTPOS_UPDATE_INTERVAL);

  // Listen for commands (play/pause) from the client.
  socket.on("data", (data: Buffer) => {
    const command = data.toString().trim().toLowerCase();
    console.log("Received command:", command);
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

  socket.on("close", () => {
    console.log("Client disconnected");
    clearInterval(ggaIntervalId);
    clearInterval(bestposIntervalId);
  });

  socket.on("error", (err: Error) => {
    console.error("Socket error:", err.message);
    clearInterval(ggaIntervalId);
    clearInterval(bestposIntervalId);
  });
});

server.on("error", (err: Error) => {
  console.error("Server error:", err.message);
});

server.listen(PORT, HOST, () => {
  console.log(`NMEA GGA simulator running on port ${PORT}`);
  console.log(`GeoJSON path: ${GEOJSON_INPUT_PATH}`);

  const { networkInterfaces } = require("os");
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (!net.internal && net.family === "IPv4") {
        console.log(`  ${net.address}:${PORT}`);
      }
    }
  }
});
