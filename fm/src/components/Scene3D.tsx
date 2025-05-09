import { Stage, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useRef, useState } from "react";
import { Group } from "three";

// Define a type for orbit data
type OrbitData = {
  target: [number, number, number];
  position: [number, number, number];
  zoom: number;
};

function PositionDisplay({
  position,
  rotation,
  orbitData,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  orbitData?: OrbitData;
}) {
  // Convert the model's position to screen position
  // Model moves from -5 to 0, we want display to move from left to center
  const screenX = ((position[0] + 5) / 5) * 50; // Convert -5 to 0 range to 0 to 50% of screen width

  return (
    <div
      className="absolute top-5 left-0 z-[1000] font-mono bg-black/70 text-white px-4 py-2 rounded"
      style={{
        left: `${screenX}%`,
        transform: "translateX(-50%)",
      }}
    >
      <div>
        Position: X: {position[0].toFixed(2)} Y: {position[1].toFixed(2)} Z:{" "}
        {position[2].toFixed(2)}
      </div>
      <div>
        Rotation: X: {rotation[0].toFixed(2)} Y: {rotation[1].toFixed(2)} Z:{" "}
        {rotation[2].toFixed(2)}
      </div>
      {orbitData && (
        <>
          <div className="mt-2 pt-1 border-t border-white/30">
            <strong>Orbit Controls:</strong>
          </div>
          <div>
            Target: X: {orbitData.target[0].toFixed(2)} Y:{" "}
            {orbitData.target[1].toFixed(2)} Z: {orbitData.target[2].toFixed(2)}
          </div>
          <div>
            Camera: X: {orbitData.position[0].toFixed(2)} Y:{" "}
            {orbitData.position[1].toFixed(2)} Z:{" "}
            {orbitData.position[2].toFixed(2)}
          </div>
          <div>Zoom: {orbitData.zoom.toFixed(2)}</div>
        </>
      )}
    </div>
  );
}

function Model({
  onUpdate,
}: {
  onUpdate: (
    position: [number, number, number],
    rotation: [number, number, number]
  ) => void;
}) {
  const { scene } = useGLTF("/src/assets/swarmbot.glb");
  const modelRef = useRef<Group>(null);

  return <primitive ref={modelRef} object={scene} />;
}

// OrbitControlsWrapper and all orbit controls logic removed to disable orbit controls

export default function Scene3D() {
  const [position, setPosition] = useState<[number, number, number]>([0, 0, 0]);
  const [rotation, setRotation] = useState<[number, number, number]>([0, 0, 0]);
  const [orbitData, setOrbitData] = useState<OrbitData | undefined>(undefined);

  return (
    <div className=" flex-1 ">
      {/* <PositionDisplay
        position={position}
        rotation={rotation}
        orbitData={orbitData}
      /> */}

      <Canvas camera={{ position: [-5, 1, 8], fov: 30 }}>
        <Stage environment="city" intensity={0.6}>
          <Model
            onUpdate={(pos, rot) => {
              setPosition(pos);
              setRotation(rot);
            }}
          />
        </Stage>
      </Canvas>
    </div>
  );
}
