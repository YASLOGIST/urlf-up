import { useRef, useMemo, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface Earth3DProps {
  scrollProgress: MutableRefObject<number>
}

// Strategic global power nodes — financial capitals + Cairo (home base)
const HOTSPOTS: Array<{ lat: number; lon: number; tag: string }> = [
  { lat: 40.7128, lon: -74.006, tag: 'NYC' },
  { lat: 51.5074, lon: -0.1278, tag: 'LON' },
  { lat: 35.6762, lon: 139.6503, tag: 'TKY' },
  { lat: 25.2048, lon: 55.2708, tag: 'DXB' },
  { lat: 22.3193, lon: 114.1694, tag: 'HKG' },
  { lat: 30.0444, lon: 31.2357, tag: 'CAI' },
  { lat: 1.3521, lon: 103.8198, tag: 'SGP' },
  { lat: 47.3769, lon: 8.5417, tag: 'ZRH' },
  { lat: 37.7749, lon: -122.4194, tag: 'SFO' },
  { lat: -33.8688, lon: 151.2093, tag: 'SYD' },
]

const latLonToVector3 = (lat: number, lon: number, radius: number): THREE.Vector3 => {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lon + 180) * (Math.PI / 180)
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  uniform vec3 glowColor;
  uniform float glowIntensity;
  void main() {
    float intensity = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.6);
    gl_FragColor = vec4(glowColor, 1.0) * intensity * glowIntensity;
  }
`

export function Earth3D({ scrollProgress }: Earth3DProps) {
  const groupRef = useRef<THREE.Group>(null)
  const wireRef = useRef<THREE.Mesh>(null)
  const atmosphereRef = useRef<THREE.Mesh>(null)
  const hotspotsRef = useRef<THREE.Group>(null)

  const hotspotPositions = useMemo(
    () => HOTSPOTS.map((h) => latLonToVector3(h.lat, h.lon, 2.04)),
    [],
  )

  useFrame((state, delta) => {
    if (!groupRef.current) return

    const progress = scrollProgress.current
    const t = state.clock.elapsedTime

    // Base idle rotation + scroll-driven amplification
    groupRef.current.rotation.y += delta * 0.08 + progress * 0.015
    groupRef.current.rotation.x = THREE.MathUtils.lerp(
      groupRef.current.rotation.x,
      progress * Math.PI * 0.28,
      0.08,
    )

    // Scroll-driven scale — cinematic zoom-in
    const targetScale = 1 + progress * 0.55
    const currentScale = groupRef.current.scale.x
    const newScale = THREE.MathUtils.lerp(currentScale, targetScale, 0.1)
    groupRef.current.scale.setScalar(newScale)

    // Atmospheric pulse
    if (atmosphereRef.current) {
      const pulse = 1 + Math.sin(t * 1.8) * 0.025
      atmosphereRef.current.scale.setScalar(pulse)
    }

    // Counter-rotate inner wireframe slightly for parallax depth
    if (wireRef.current) {
      wireRef.current.rotation.y -= delta * 0.03
    }

    // Hotspots subtle pulse via material
    if (hotspotsRef.current) {
      hotspotsRef.current.children.forEach((child, i) => {
        const mesh = child.children[0] as THREE.Mesh
        if (mesh && mesh.material) {
          const mat = mesh.material as THREE.MeshBasicMaterial
          mat.opacity = 0.6 + Math.sin(t * 3 + i * 0.7) * 0.4
        }
      })
    }
  })

  return (
    <group ref={groupRef}>
      {/* Inner obsidian core — gives the wireframe weight */}
      <mesh>
        <sphereGeometry args={[1.96, 64, 64]} />
        <meshStandardMaterial
          color="#080604"
          metalness={0.95}
          roughness={0.35}
          emissive="#1a1208"
          emissiveIntensity={0.15}
        />
      </mesh>

      {/* Primary gold icosahedron wireframe — the geometric soul */}
      <mesh>
        <icosahedronGeometry args={[2, 4]} />
        <meshBasicMaterial color="#D4AF37" wireframe transparent opacity={0.65} />
      </mesh>

      {/* Secondary lat/lon wireframe — the grid */}
      <mesh ref={wireRef}>
        <sphereGeometry args={[2.02, 36, 18]} />
        <meshBasicMaterial color="#C9A961" wireframe transparent opacity={0.28} />
      </mesh>

      {/* Outer detail ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.25, 0.005, 16, 128]} />
        <meshBasicMaterial color="#FFD700" transparent opacity={0.4} />
      </mesh>

      {/* Fire-red atmospheric glow */}
      <mesh ref={atmosphereRef}>
        <sphereGeometry args={[2.18, 64, 64]} />
        <shaderMaterial
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          uniforms={{
            glowColor: { value: new THREE.Color('#FF3D00') },
            glowIntensity: { value: 0.85 },
          }}
          vertexShader={ATMOSPHERE_VERTEX}
          fragmentShader={ATMOSPHERE_FRAGMENT}
        />
      </mesh>

      {/* Power node hotspots */}
      <group ref={hotspotsRef}>
        {hotspotPositions.map((pos, i) => (
          <group key={i} position={[pos.x, pos.y, pos.z]}>
            <mesh>
              <sphereGeometry args={[0.035, 12, 12]} />
              <meshBasicMaterial color="#FF3D00" transparent opacity={1} />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.07, 12, 12]} />
              <meshBasicMaterial color="#FF3D00" transparent opacity={0.18} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}
