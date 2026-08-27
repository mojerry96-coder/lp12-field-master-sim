import { useMemo, useRef } from "react"
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";

const RED = "#ef5b55";
const ROAD = "#464a50";
const ROAD_EDGE = "#5f646b";
const PAVEMENT = "#b8b8b2";
const BUILDING = "#d7d7d1";
const WINDOW = "#7d8790";
const TREE = "#637967";

/**
 * The dead-zone explainer's own street.
 *
 * The handoff offers a swap here: replace RoadEnvironment and ExplainerPole
 * with the simulation's real SiteEnvironment and LP12 model. Not taken, on
 * purpose. The LP12 GLB ships unassembled — every component sits at a rest
 * offset until its clip runs — so dropping it into an explainer that plays
 * before any clip has run would show the learner a pile of scattered parts
 * exactly where the diagram needs one clean pole. It would also pull a 1.5 MB
 * model and an 845 KB environment onto the page whose whole job is warming
 * those same assets in the background for the workspace that follows.
 *
 * This scene is purpose-built, weighs nothing, and is the geometry the diagram
 * actually needs. The red hemisphere, footprint ring and cinematic camera are
 * the parts that carry the meaning, and they are unchanged.
 */
function Building({ position, size = [2.2, 2.8, 2.1] }) {
  const [w, h, d] = size;

  return (
    <group position={position}>
      <mesh castShadow receiveShadow position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={BUILDING} roughness={0.78} />
      </mesh>

      {/* simple window bands */}
      {[0.7, 1.35, 2.0].map((y) => (
        <mesh key={y} position={[Math.sign(position[0]) * (-w / 2 - 0.006), y, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[d * 0.72, 0.16]} />
          <meshBasicMaterial color={WINDOW} transparent opacity={0.26} />
        </mesh>
      ))}
    </group>
  );
}

function Tree({ position }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.65, 0]}>
        <cylinderGeometry args={[0.055, 0.08, 1.3, 12]} />
        <meshStandardMaterial color="#6d6258" roughness={0.9} />
      </mesh>

      <mesh castShadow position={[0, 1.5, 0]}>
        <sphereGeometry args={[0.48, 18, 14]} />
        <meshStandardMaterial color={TREE} roughness={0.95} />
      </mesh>
    </group>
  );
}

function LaneMarks() {
  const zValues = [-7.2, -5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4, 7.2];

  return (
    <group position={[0, 0.015, 0]}>
      {[-1.65, 1.65].flatMap((x) =>
        zValues.map((z) => (
          <mesh key={`${x}-${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0, z]}>
            <planeGeometry args={[0.08, 0.82]} />
            <meshBasicMaterial color="#ecebe5" />
          </mesh>
        ))
      )}
    </group>
  );
}

function RoadEnvironment() {
  const treeZ = [-6.7, -4.2, -1.7, 0.8, 3.3, 5.8];

  return (
    <group>
      {/* ground */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.025, 0]}>
        <planeGeometry args={[22, 22]} />
        <meshStandardMaterial color="#d7d6d0" roughness={0.96} />
      </mesh>

      {/* road */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[8.8, 18]} />
        <meshStandardMaterial color={ROAD} roughness={0.91} />
      </mesh>

      {/* road edge strips */}
      {[-4.42, 4.42].map((x) => (
        <mesh key={x} receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.003, 0]}>
          <planeGeometry args={[0.18, 18]} />
          <meshBasicMaterial color={ROAD_EDGE} />
        </mesh>
      ))}

      {/* pavements */}
      {[-5.25, 5.25].map((x) => (
        <mesh key={x} receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.005, 0]}>
          <planeGeometry args={[1.45, 18]} />
          <meshStandardMaterial color={PAVEMENT} roughness={0.9} />
        </mesh>
      ))}

      <LaneMarks />

      {/* two building rows receding into background */}
      <Building position={[-7.0, 0, -4.5]} size={[2.7, 3.1, 2.6]} />
      <Building position={[-7.0, 0, 0]} size={[2.6, 2.7, 2.3]} />
      <Building position={[-7.0, 0, 4.6]} size={[2.8, 3.35, 2.5]} />

      <Building position={[7.0, 0, -4.5]} size={[2.7, 3.1, 2.6]} />
      <Building position={[7.0, 0, 0]} size={[2.6, 2.7, 2.3]} />
      <Building position={[7.0, 0, 4.6]} size={[2.8, 3.35, 2.5]} />

      {/* trees line both sides */}
      {treeZ.map((z) => (
        <Tree key={`left-${z}`} position={[-4.95, 0, z]} />
      ))}
      {treeZ.map((z) => (
        <Tree key={`right-${z}`} position={[4.95, 0, z]} />
      ))}
    </group>
  );
}

function ExplainerPole() {
  return (
    <group position={[0, 0, 0.25]}>
      <mesh castShadow position={[0, 2.1, 0]}>
        <cylinderGeometry args={[0.105, 0.135, 4.2, 28]} />
        <meshStandardMaterial color="#b9bec1" metalness={0.75} roughness={0.26} />
      </mesh>

      {/* lamp arm */}
      <mesh castShadow position={[0.52, 3.8, 0]} rotation={[0, 0, Math.PI / 2.65]}>
        <cylinderGeometry args={[0.045, 0.052, 1.25, 16]} />
        <meshStandardMaterial color="#b9bec1" metalness={0.72} roughness={0.28} />
      </mesh>

      <mesh castShadow position={[0.98, 4.08, 0]}>
        <boxGeometry args={[0.8, 0.12, 0.26]} />
        <meshStandardMaterial color="#bfc4c6" metalness={0.63} roughness={0.31} />
      </mesh>

      {/* LP12 */}
      <group position={[0.26, 2.75, 0]}>
        <mesh castShadow position={[0, 0, 0]}>
          <boxGeometry args={[0.48, 1.05, 0.28]} />
          <meshStandardMaterial color="#e5e7e5" roughness={0.43} metalness={0.12} />
        </mesh>

        <mesh position={[0, -0.59, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.22, 12]} />
          <meshStandardMaterial color="#27292c" />
        </mesh>

        <mesh position={[0.13, -0.59, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.22, 12]} />
          <meshStandardMaterial color="#27292c" />
        </mesh>
      </group>
    </group>
  );
}

function DomeAndFootprint() {
  const dome = useRef();
  const material = useRef();
  const baseScale = useRef(1);

  const footprint = useMemo(() => {
    const pts = [];
    const radiusX = 3.45;
    const radiusZ = 2.95;

    for (let i = 0; i <= 120; i += 1) {
      const t = (i / 120) * Math.PI * 2;
      pts.push(
        new THREE.Vector3(
          Math.cos(t) * radiusX,
          0.035,
          Math.sin(t) * radiusZ + 0.25
        )
      );
    }

    return pts;
  }, []);

  useFrame(({ clock }) => {
    const seconds = clock.getElapsedTime();

    // Gentle explainer pulse, not a gamey bounce.
    const pulse = 1 + Math.sin(seconds * 1.25) * 0.018;
    baseScale.current = pulse;

    if (dome.current) {
      dome.current.scale.set(pulse, pulse, pulse);
    }

    if (material.current) {
      material.current.opacity = 0.165 + Math.sin(seconds * 1.25) * 0.015;
    }
  });

  return (
    <group>
      {/* Upper half of a sphere; the ground cuts the sphere at its widest point. */}
      <mesh ref={dome} position={[0, 0.025, 0.25]}>
        <sphereGeometry
          args={[
            3.45,
            72,
            42,
            0,
            Math.PI * 2,
            0,
            Math.PI / 2
          ]}
        />
        <meshPhysicalMaterial
          ref={material}
          color={RED}
          transparent
          opacity={0.17}
          roughness={0.15}
          metalness={0}
          transmission={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* clear red silhouette around the dome */}
      <mesh position={[0, 0.03, 0.25]} scale={[1.002, 1.002, 1.002]}>
        <sphereGeometry
          args={[
            3.45,
            72,
            42,
            0,
            Math.PI * 2,
            0,
            Math.PI / 2
          ]}
        />
        <meshBasicMaterial
          color={RED}
          transparent
          opacity={0.065}
          wireframe
          depthWrite={false}
        />
      </mesh>

      <Line
        points={footprint}
        color={RED}
        lineWidth={1.7}
        dashed
        dashScale={1.15}
        dashSize={0.12}
        gapSize={0.08}
        transparent
        opacity={0.96}
      />

      {/* visualised failed/blocked signal rays */}
      <Line
        points={[[0, 2.85, 0.25], [-2.55, 0.06, 1.5]]}
        color={RED}
        lineWidth={0.65}
        transparent
        opacity={0.30}
      />
      <Line
        points={[[0, 2.85, 0.25], [2.55, 0.06, 1.5]]}
        color={RED}
        lineWidth={0.65}
        transparent
        opacity={0.30}
      />
    </group>
  );
}

function CinematicCamera() {
  useFrame(({ camera, clock }) => {
    const t = clock.getElapsedTime();

    // Slow 8-second explainer motion.
    // Only a few degrees of lateral movement; the viewport remains readable.
    const x = Math.sin(t * 0.28) * 0.42;
    const y = 2.55 + Math.sin(t * 0.22) * 0.05;
    const z = 7.55 + Math.cos(t * 0.22) * 0.16;

    camera.position.lerp(
      new THREE.Vector3(x, y, z),
      0.035
    );

    camera.lookAt(0, 1.75, 0.0);
  });

  return null;
}

export default function DeadZoneViewport() {
  return (
    <div className="dead-zone-3d">
      <Canvas
        dpr={[1, 1.75]}
        camera={{
          fov: 42,
          near: 0.1,
          far: 80,
          position: [0, 2.55, 7.6]
        }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance"
        }}
        shadows
      >
        <color attach="background" args={["#c8d2d5"]} />
        <fog attach="fog" args={["#c8d2d5", 8.5, 19]} />

        <hemisphereLight
          intensity={1.4}
          color="#eef5ff"
          groundColor="#7f766e"
        />

        <directionalLight
          castShadow
          intensity={2.0}
          color="#fff7ed"
          position={[4.8, 8.5, 5.2]}
          shadow-mapSize={[1024, 1024]}
        />

        <directionalLight
          intensity={0.55}
          color="#d7e8ff"
          position={[-4, 4, -5]}
        />

        <RoadEnvironment />
        <ExplainerPole />
        <DomeAndFootprint />
        <CinematicCamera />
      </Canvas>
    </div>
  );
}
