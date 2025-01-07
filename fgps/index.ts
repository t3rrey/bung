import { Server, Socket } from "net";
import type { GGAPacket } from "nmea-simple";

// Configuration
const PORT = 3006;
const HOST = "0.0.0.0"; // Listen on all available network interfaces
const UPDATE_INTERVAL = 100; // milliseconds

// Initial position and state
let currentPosition = {
  latitude: 37.7749,
  longitude: -122.4194,
  altitude: 10.0,
  satellitesInView: 8,
  horizontalDilution: 1.2,
};

// Function to simulate movement
const updatePosition = (): void => {
  // Simulate small random movement
  currentPosition.latitude += (Math.random() - 0.5) * 0.0001;
  currentPosition.longitude += (Math.random() - 0.5) * 0.0001;
  // Simulate small altitude changes
  currentPosition.altitude += (Math.random() - 0.5) * 0.1;
  // Occasionally vary satellites and HDOP
  if (Math.random() < 0.1) {
    currentPosition.satellitesInView = Math.max(
      4,
      Math.min(
        12,
        currentPosition.satellitesInView + Math.floor(Math.random() * 3) - 1
      )
    );
    currentPosition.horizontalDilution = Math.max(
      0.8,
      Math.min(
        2.0,
        currentPosition.horizontalDilution + (Math.random() - 0.5) * 0.1
      )
    );
  }
};

// Function to convert decimal degrees to NMEA format
const convertToNMEA = (
  decimal: number,
  isLat: boolean
): { value: string; direction: string } => {
  const absolute = Math.abs(decimal);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  const format = isLat ? [2, 2] : [3, 2]; // [deg digits, decimal places]

  return {
    value: `${degrees.toString().padStart(format[0], "0")}${minutes
      .toFixed(format[1])
      .padStart(7, "0")}`,
    direction: isLat ? (decimal >= 0 ? "N" : "S") : decimal >= 0 ? "E" : "W",
  };
};

// Function to generate GGA data
const getFakeGGAData = (): GGAPacket => {
  updatePosition();

  const lat = convertToNMEA(currentPosition.latitude, true);
  const lon = convertToNMEA(currentPosition.longitude, false);
  const now = new Date();

  return {
    sentenceId: "GGA",
    time: now,
    latitude: currentPosition.latitude,
    longitude: currentPosition.longitude,
    fixType: "fix",
    satellitesInView: currentPosition.satellitesInView,
    horizontalDilution: currentPosition.horizontalDilution,
    altitudeMeters: currentPosition.altitude,
    geoidalSeperation: -24.7, // Typical value for San Francisco
    differentialAge: undefined,
    differentialRefStn: undefined,
  };
};

// Function to format time for NMEA
const formatTime = (date: Date): string => {
  return (
    date.getUTCHours().toString().padStart(2, "0") +
    date.getUTCMinutes().toString().padStart(2, "0") +
    date.getUTCSeconds().toString().padStart(2, "0") +
    "." +
    date.getUTCMilliseconds().toString().padStart(3, "0")
  );
};

// Function to format GGA message
const formatGGAMessage = (data: GGAPacket): string => {
  const lat = convertToNMEA(data.latitude, true);
  const lon = convertToNMEA(data.longitude, false);

  const fields = [
    "$GPGGA",
    formatTime(data.time),
    lat.value,
    lat.direction,
    lon.value,
    lon.direction,
    data.fixType === "fix" ? "1" : "0",
    data.satellitesInView.toString(),
    data.horizontalDilution.toFixed(1),
    data.altitudeMeters.toFixed(1),
    "M",
    data.geoidalSeperation.toFixed(1),
    "M",
    data.differentialAge?.toString() || "",
    data.differentialRefStn || "",
  ];

  const message = fields.join(",");
  const checksum = calculateChecksum(message);
  return `${message}*${checksum}\r\n`;
};

// Function to calculate NMEA checksum
const calculateChecksum = (message: string): string => {
  let checksum = 0;
  // Skip the $ at the start
  for (let i = 1; i < message.length; i++) {
    checksum ^= message.charCodeAt(i);
  }
  return checksum.toString(16).toUpperCase().padStart(2, "0");
};

// Create TCP server
const server = new Server();

// Handle client connections
server.on("connection", (socket: Socket) => {
  console.log("Client connected");

  // Set up interval to send GGA messages
  const intervalId = setInterval(() => {
    const ggaData = getFakeGGAData();
    const message = formatGGAMessage(ggaData);
    socket.write(message);
  }, UPDATE_INTERVAL);

  // Handle client disconnect
  socket.on("close", () => {
    console.log("Client disconnected");
    clearInterval(intervalId);
  });

  // Handle errors
  socket.on("error", (err: Error) => {
    console.error("Socket error:", err.message);
    clearInterval(intervalId);
  });
});

// Handle server errors
server.on("error", (err: Error) => {
  console.error("Server error:", err.message);
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(`NMEA GGA simulator running on port ${PORT}`);
  console.log(
    `Try connecting with netcat or telnet to any of these addresses:`
  );

  // Get all network interfaces
  const { networkInterfaces } = require("os");
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip internal and non-IPv4 addresses
      if (!net.internal && net.family === "IPv4") {
        console.log(`  ${net.address}:${PORT}`);
      }
    }
  }
  console.log(`  localhost:${PORT}`);
  console.log(`  127.0.0.1:${PORT}`);
});
