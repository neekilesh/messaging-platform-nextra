import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ChevronDown,
  ChevronUp,
  Gamepad2,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';

type SceneMode = 'game' | 'studio';
type GameLifecycle = 'title' | 'playing' | 'paused' | 'victory' | 'gameover';
type FinishKey = 'cyan' | 'crimson' | 'gold' | 'violet';
type LightingKey = 'nebula' | 'noon' | 'storm';

interface LeaderboardScore {
  id: string;
  score: number;
  wave: number;
  username: string;
  displayName: string;
}

const FINISH_PALETTES: Record<FinishKey, { label: string; primary: number; accent: number; hex: string }> = {
  cyan: { label: 'Solaris Cyan', primary: 0x1e293b, accent: 0x22d3ee, hex: '#22d3ee' },
  crimson: { label: 'Crimson Forge', primary: 0x271924, accent: 0xf43f5e, hex: '#f43f5e' },
  gold: { label: 'Auric Alloy', primary: 0x292524, accent: 0xf59e0b, hex: '#f59e0b' },
  violet: { label: 'Nebula Violet', primary: 0x1e1b4b, accent: 0xa855f7, hex: '#a855f7' },
};

function detectSoftwareGl(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (!dbg) return false;
  const renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
  return /swiftshader|llvmpipe|software/i.test(renderer);
}

function afterDraw(fn: () => void): number {
  let id1 = 0;
  let id2 = 0;
  id1 = requestAnimationFrame(() => {
    id2 = requestAnimationFrame(fn);
  });
  return id1 || id2;
}

function createArenaGridTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#090f20';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = 'rgba(34, 211, 238, 0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 512, 512);

  ctx.strokeStyle = 'rgba(139, 92, 246, 0.14)';
  ctx.lineWidth = 1;
  for (let i = 64; i < 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  return tex;
}

function buildStarRoverGroup(palette: { primary: number; accent: number }) {
  const group = new THREE.Group();
  group.name = 'StarforgeRover';

  const bodyMat = new THREE.MeshStandardMaterial({
    color: palette.primary,
    metalness: 0.65,
    roughness: 0.28,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.4,
    roughness: 0.55,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 0.65,
    metalness: 0.2,
    roughness: 0.2,
  });
  const canopyMat = new THREE.MeshPhysicalMaterial({
    color: 0x93c5fd,
    metalness: 0.1,
    roughness: 0.08,
    transmission: 0.55,
    transparent: true,
    opacity: 0.88,
  });

  const parts: Array<{ mesh: THREE.Object3D; explodeVec: THREE.Vector3 }> = [];

  const register = (mesh: THREE.Object3D, explodeVec: THREE.Vector3) => {
    mesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    mesh.userData.basePos = mesh.position.clone();
    mesh.userData.explodeVec = explodeVec;
    group.add(mesh);
    parts.push({ mesh, explodeVec });
  };

  // 1. Main sculpted fuselage
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.42, 2.3), bodyMat);
  hull.position.set(0, 0.55, 0);
  register(hull, new THREE.Vector3(0, 0.2, 0));

  // 2. Nose wedge
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.68, 1.0, 4), bodyMat);
  nose.rotation.x = -Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.scale.set(1.15, 1, 0.46);
  nose.position.set(0, 0.52, -1.55);
  register(nose, new THREE.Vector3(0, 0.1, -1.3));

  // 3. Glass cockpit canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.48, 20, 14), canopyMat);
  canopy.scale.set(0.95, 0.55, 1.45);
  canopy.position.set(0, 0.82, -0.15);
  register(canopy, new THREE.Vector3(0, 1.25, 0));

  // 4. Dorsal Stabilizer Fin
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.52, 0.9), trimMat);
  fin.position.set(0, 0.98, 0.65);
  register(fin, new THREE.Vector3(0, 1.45, 0.4));

  // 5 & 6. Port & Starboard Wing Nacelles
  const portPod = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 1.75, 12), trimMat);
  portPod.rotation.x = Math.PI / 2;
  portPod.position.set(-0.98, 0.5, 0.15);
  register(portPod, new THREE.Vector3(-1.35, 0.15, 0));

  const starPod = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 1.75, 12), trimMat);
  starPod.rotation.x = Math.PI / 2;
  starPod.position.set(0.98, 0.5, 0.15);
  register(starPod, new THREE.Vector3(1.35, 0.15, 0));

  // 7 & 8. Twin Rear Thruster Rings
  const leftGlow = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.055, 10, 24), accentMat);
  leftGlow.position.set(-0.98, 0.5, 1.06);
  register(leftGlow, new THREE.Vector3(-1.35, 0.15, 0.9));

  const rightGlow = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.055, 10, 24), accentMat);
  rightGlow.position.set(0.98, 0.5, 1.06);
  register(rightGlow, new THREE.Vector3(1.35, 0.15, 0.9));

  // 9. Ventral Shield Core
  const shieldCore = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 0.16, 16), accentMat);
  shieldCore.position.set(0, 0.25, 0);
  register(shieldCore, new THREE.Vector3(0, -0.75, 0));

  return { group, parts, bodyMat, accentMat };
}

function buildOrbitalSpireGroup() {
  const spire = new THREE.Group();
  spire.name = 'OrbitalRelaySpire';

  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x162038,
    metalness: 0.72,
    roughness: 0.32,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 0.9,
    roughness: 0.18,
    metalness: 0.2,
  });

  const base1 = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.1, 0.6, 6), darkMetal);
  base1.position.y = 0.3;
  base1.castShadow = true;
  base1.receiveShadow = true;
  spire.add(base1);

  const base2 = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.2, 0.7, 6), darkMetal);
  base2.position.y = 0.95;
  base2.castShadow = true;
  spire.add(base2);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.58, 5.2, 8), darkMetal);
  mast.position.y = 3.6;
  mast.castShadow = true;
  spire.add(mast);

  const coreCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0), beaconMat);
  coreCrystal.position.y = 6.9;
  spire.add(coreCrystal);

  const gyroA = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.08, 10, 32), beaconMat);
  gyroA.position.y = 6.9;
  spire.add(gyroA);

  const gyroB = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.06, 10, 32), darkMetal);
  gyroB.position.y = 6.9;
  gyroB.rotation.x = Math.PI / 3;
  spire.add(gyroB);

  return { spire, coreCrystal, gyroA, gyroB };
}

export function NexusArena3D({ onExit }: { onExit: () => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [sceneMode, setSceneMode] = useState<SceneMode>('game');
  const [lifecycle, setLifecycle] = useState<GameLifecycle>('title');
  const [dockOpen, setDockOpen] = useState(true);
  const [soundMuted, setSoundMuted] = useState(false);

  // HUD game telemetry (numbers only, tabular-nums)
  const [hud, setHud] = useState({ score: 0, wave: 1, hull: 3, boostReady: 100 });
  const [leaderboard, setLeaderboard] = useState<LeaderboardScore[]>([]);
  const [scoreSaved, setScoreSaved] = useState(false);

  // Studio customization state
  const [explodeTarget, setExplodeTarget] = useState(0);
  const [finishKey, setFinishKey] = useState<FinishKey>('cyan');
  const [lightingKey, setLightingKey] = useState<LightingKey>('nebula');

  // Mutable refs accessed cleanly by animation loop without stale closures
  const sceneModeRef = useRef<SceneMode>(sceneMode);
  sceneModeRef.current = sceneMode;
  const lifecycleRef = useRef<GameLifecycle>(lifecycle);
  lifecycleRef.current = lifecycle;
  const explodeTargetRef = useRef(explodeTarget);
  explodeTargetRef.current = explodeTarget;
  const finishKeyRef = useRef<FinishKey>(finishKey);
  finishKeyRef.current = finishKey;
  const lightingKeyRef = useRef<LightingKey>(lightingKey);
  lightingKeyRef.current = lightingKey;
  const soundMutedRef = useRef(soundMuted);
  soundMutedRef.current = soundMuted;

  const cameraPresetCallbackRef = useRef<((preset: 'hero' | 'top' | 'low') => void) | null>(null);
  const resetGameCallbackRef = useRef<(() => void) | null>(null);

  // Procedural Web Audio sound effects
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playTone = useCallback((freq: number, dur: number, type: OscillatorType = 'triangle', gain = 0.08) => {
    if (soundMutedRef.current) return;
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.65), ctx.currentTime + dur);
      g.gain.setValueAtTime(gain, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {
      // ignore audio context errors
    }
  }, []);

  const loadLeaderboard = useCallback(async () => {
    try {
      const res = await apiRequest<{ scores: LeaderboardScore[] }>('/api/v1/ai/scores');
      setLeaderboard(res.scores);
    } catch {
      // ignore fetch issue
    }
  }, []);

  const submitScore = useCallback(
    async (score: number, wave: number) => {
      if (score <= 0) return;
      try {
        await apiRequest('/api/v1/ai/scores', {
          method: 'POST',
          body: JSON.stringify({ score, wave, mode: 'starforge' }),
        });
        setScoreSaved(true);
        loadLeaderboard();
      } catch {
        // ignore save error
      }
    },
    [loadLeaderboard]
  );

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  const startGame = useCallback(() => {
    setScoreSaved(false);
    resetGameCallbackRef.current?.();
    setSceneMode('game');
    setLifecycle('playing');
    playTone(540, 0.14, 'sine', 0.09);
  }, [playTone]);

  // Global keyboard shortcuts (H = toggle dock, Esc = pause/resume, Enter = start from title)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') {
        setDockOpen((o) => !o);
      } else if (e.key === 'Escape' && sceneModeRef.current === 'game') {
        if (lifecycleRef.current === 'playing') setLifecycle('paused');
        else if (lifecycleRef.current === 'paused') setLifecycle('playing');
      } else if (
        (e.key === 'Enter' || e.code === 'Space') &&
        sceneModeRef.current === 'game' &&
        lifecycleRef.current === 'title'
      ) {
        e.preventDefault();
        startGame();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [startGame]);

  // Main Three.js WebGL Mount
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const gl = renderer.getContext();
    const isSoftwareGl = detectSoftwareGl(gl);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060a17);
    scene.fog = new THREE.FogExp2(0x060a17, 0.017);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose();

    const camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 220);
    camera.position.set(0, 14, 21);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = 6;
    controls.maxDistance = 42;
    controls.enabled = false;

    // Three-point + Rim lighting
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xf8fafc, 2.4);
    keyLight.position.set(16, 26, 14);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 75;
    const d = 26;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x22d3ee, 1.3);
    rimLight.position.set(-18, 12, -16);
    scene.add(rimLight);

    // Extended procedural grid floor
    const gridTex = createArenaGridTexture();
    gridTex.anisotropy = maxAniso;
    const floorMat = new THREE.MeshStandardMaterial({
      map: gridTex,
      roughness: 0.72,
      metalness: 0.25,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(110, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Arena ring boundary
    const arenaRadius = 17.5;
    const arenaRingMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.7,
      roughness: 0.2,
    });
    const arenaRing = new THREE.Mesh(
      new THREE.TorusGeometry(arenaRadius, 0.14, 10, 96),
      arenaRingMat
    );
    arenaRing.rotation.x = Math.PI / 2;
    arenaRing.position.y = 0.08;
    scene.add(arenaRing);

    // Center Orbital Relay Spire (landmark)
    const { spire, coreCrystal, gyroA, gyroB } = buildOrbitalSpireGroup();
    scene.add(spire);

    // Instanced Perimeter Crystal Outcrops (36 instances with color & scale variance)
    const crystalGeo = new THREE.ConeGeometry(0.75, 3.2, 5);
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.25,
      metalness: 0.55,
      emissive: 0x1e1b4b,
      emissiveIntensity: 0.35,
    });
    const crystalCount = 36;
    const crystals = new THREE.InstancedMesh(crystalGeo, crystalMat, crystalCount);
    const dummy = new THREE.Object3D();
    const paletteColors = [new THREE.Color(0x22d3ee), new THREE.Color(0x8b5cf6), new THREE.Color(0x38bdf8)];
    for (let i = 0; i < crystalCount; i++) {
      const ang = (i / crystalCount) * Math.PI * 2 + (i % 3) * 0.08;
      const rad = arenaRadius + 2.4 + (i % 4) * 1.4;
      const scaleVar = 0.85 + ((i * 37) % 30) / 100; // ±15% scale variance
      dummy.position.set(Math.cos(ang) * rad, 1.3 * scaleVar, Math.sin(ang) * rad);
      dummy.rotation.set(((i % 5) - 2) * 0.08, ang, ((i % 3) - 1) * 0.09);
      dummy.scale.set(scaleVar, scaleVar * 1.25, scaleVar);
      dummy.updateMatrix();
      crystals.setMatrixAt(i, dummy.matrix);
      crystals.setColorAt(i, paletteColors[i % paletteColors.length]);
    }
    crystals.instanceMatrix.needsUpdate = true;
    if (crystals.instanceColor) crystals.instanceColor.needsUpdate = true;
    crystals.computeBoundingSphere();
    scene.add(crystals);

    // Hero Rover
    const rover = buildStarRoverGroup(FINISH_PALETTES[finishKeyRef.current]);
    rover.group.position.set(0, 0, 7);
    scene.add(rover.group);

    // Pooled Energy Shards, Chaser Drones, Pulse Mines, and Spark Particles
    interface ShardEntity {
      mesh: THREE.Mesh;
      active: boolean;
      pos: THREE.Vector3;
    }
    interface DroneEntity {
      group: THREE.Group;
      active: boolean;
      pos: THREE.Vector3;
      vel: THREE.Vector3;
      speed: number;
    }
    interface MineEntity {
      group: THREE.Group;
      ring: THREE.Mesh;
      active: boolean;
      pos: THREE.Vector3;
      timer: number;
    }
    interface Particle {
      mesh: THREE.Mesh;
      vel: THREE.Vector3;
      life: number;
      maxLife: number;
    }

    const shardGeo = new THREE.OctahedronGeometry(0.45, 0);
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0xfde047,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.9,
      roughness: 0.15,
    });
    const shards: ShardEntity[] = Array.from({ length: 8 }, () => {
      const mesh = new THREE.Mesh(shardGeo, shardMat);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, active: false, pos: new THREE.Vector3() };
    });

    const droneBodyMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0x9f1239,
      emissiveIntensity: 0.6,
      metalness: 0.6,
      roughness: 0.3,
    });
    const drones: DroneEntity[] = Array.from({ length: 7 }, () => {
      const g = new THREE.Group();
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), droneBodyMat);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.35), droneBodyMat);
      g.add(core, wing);
      g.visible = false;
      scene.add(g);
      return {
        group: g,
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        speed: 4.4,
      };
    });

    const mines: MineEntity[] = Array.from({ length: 4 }, () => {
      const g = new THREE.Group();
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xea580c, emissiveIntensity: 0.8 })
      );
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.6, 1.85, 28),
        new THREE.MeshBasicMaterial({ color: 0xfb7185, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      g.add(sphere, ring);
      g.visible = false;
      scene.add(g);
      return { group: g, ring, active: false, pos: new THREE.Vector3(), timer: 0 };
    });

    const particleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const particleMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    const particles: Particle[] = Array.from({ length: 40 }, () => {
      const mesh = new THREE.Mesh(particleGeo, particleMat);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, vel: new THREE.Vector3(), life: 0, maxLife: 0.4 };
    });

    const spawnBurst = (origin: THREE.Vector3, count = 10) => {
      let spawned = 0;
      for (const p of particles) {
        if (p.life <= 0) {
          p.life = 0.38;
          p.maxLife = 0.38;
          p.mesh.visible = true;
          p.mesh.position.copy(origin);
          p.vel.set(
            (Math.random() - 0.5) * 9,
            2 + Math.random() * 4,
            (Math.random() - 0.5) * 9
          );
          spawned++;
          if (spawned >= count) break;
        }
      }
    };

    // Game Simulation State
    const keys = new Set<string>();
    const roverPos = new THREE.Vector3(0, 0, 7);
    const roverVel = new THREE.Vector3();
    let roverYaw = 0;
    let score = 0;
    let wave = 1;
    let hull = 3;
    let boostCooldown = 0;
    let boostActive = 0;
    let boostBuffered = false;
    let invulnTimer = 0;
    let hitstopTimer = 0;
    let shakeTimer = 0;
    let spawnShardTimer = 0;
    let spawnMineTimer = 2.5;
    let waveQuota = 6;
    let collectedThisWave = 0;
    let explodeCurrent = 0;

    const placeRandomOnArena = (minR: number, maxR: number): THREE.Vector3 => {
      const a = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      return new THREE.Vector3(Math.cos(a) * r, 0.5, Math.sin(a) * r);
    };

    const activateWaveDrones = (w: number) => {
      const activeCount = Math.min(drones.length, 2 + w);
      for (let i = 0; i < drones.length; i++) {
        const d = drones[i];
        if (i < activeCount) {
          d.active = true;
          d.pos.copy(placeRandomOnArena(10, arenaRadius - 2));
          d.pos.y = 0.75;
          d.speed = 4.1 + w * 0.75;
          d.group.position.copy(d.pos);
          d.group.visible = true;
        } else {
          d.active = false;
          d.group.visible = false;
        }
      }
    };

    const resetGameState = () => {
      roverPos.set(0, 0, 7);
      roverVel.set(0, 0, 0);
      roverYaw = 0;
      score = 0;
      wave = 1;
      hull = 3;
      boostCooldown = 0;
      boostActive = 0;
      invulnTimer = 1.0;
      hitstopTimer = 0;
      shakeTimer = 0;
      waveQuota = 6;
      collectedThisWave = 0;
      spawnShardTimer = 0.1;
      spawnMineTimer = 3.0;
      shards.forEach((s) => {
        s.active = false;
        s.mesh.visible = false;
      });
      mines.forEach((m) => {
        m.active = false;
        m.group.visible = false;
      });
      activateWaveDrones(1);
      setHud({ score: 0, wave: 1, hull: 3, boostReady: 100 });
    };
    resetGameCallbackRef.current = resetGameState;

    cameraPresetCallbackRef.current = (preset) => {
      if (preset === 'hero') camera.position.set(8.5, 5.2, 10.5);
      else if (preset === 'top') camera.position.set(0, 22, 4);
      else camera.position.set(-7.5, 2.4, 8.5);
      controls.target.copy(rover.group.position).add(new THREE.Vector3(0, 0.6, 0));
      controls.update();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      keys.add(code);
      if (code === 'Space' && sceneModeRef.current === 'game' && lifecycleRef.current === 'playing') {
        e.preventDefault();
        boostBuffered = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const onWindowBlur = () => keys.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let disposed = false;
    let prevTime = performance.now();
    let frameHandle = 0;
    let lastAppliedFinish: FinishKey | null = null;
    let lastAppliedLight: LightingKey | null = null;

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const rawDt = (now - prevTime) / 1000;
      prevTime = now;
      const dt = Math.min(rawDt, 0.05);

      // Sync finish swatch material
      if (lastAppliedFinish !== finishKeyRef.current) {
        const pal = FINISH_PALETTES[finishKeyRef.current];
        rover.bodyMat.color.setHex(pal.primary);
        rover.accentMat.color.setHex(pal.accent);
        rover.accentMat.emissive.setHex(pal.accent);
        lastAppliedFinish = finishKeyRef.current;
      }

      // Sync lighting preset
      if (lastAppliedLight !== lightingKeyRef.current) {
        const lk = lightingKeyRef.current;
        if (lk === 'nebula') {
          scene.background = new THREE.Color(0x060a17);
          scene.fog = new THREE.FogExp2(0x060a17, 0.017);
          keyLight.color.setHex(0xf8fafc);
          keyLight.intensity = 2.4;
          rimLight.color.setHex(0x22d3ee);
        } else if (lk === 'noon') {
          scene.background = new THREE.Color(0x101c38);
          scene.fog = new THREE.FogExp2(0x101c38, 0.011);
          keyLight.color.setHex(0xfffbeb);
          keyLight.intensity = 3.1;
          rimLight.color.setHex(0x38bdf8);
        } else {
          scene.background = new THREE.Color(0x120824);
          scene.fog = new THREE.FogExp2(0x120824, 0.02);
          keyLight.color.setHex(0xe9d5ff);
          keyLight.intensity = 2.2;
          rimLight.color.setHex(0xf43f5e);
        }
        lastAppliedLight = lk;
      }

      // Spire idle orbital motion
      coreCrystal.rotation.y += dt * 0.9;
      gyroA.rotation.x += dt * 0.7;
      gyroA.rotation.y += dt * 0.5;
      gyroB.rotation.z -= dt * 0.65;

      // Studio vs Game camera & explosion logic
      const isStudio = sceneModeRef.current === 'studio';
      controls.enabled = isStudio;

      const targetExplode = isStudio ? explodeTargetRef.current : 0;
      explodeCurrent = THREE.MathUtils.damp(explodeCurrent, targetExplode, 7, dt);
      for (const part of rover.parts) {
        const base = part.mesh.userData.basePos as THREE.Vector3;
        part.mesh.position.copy(base).addScaledVector(part.explodeVec, explodeCurrent);
      }

      if (isStudio) {
        rover.group.position.set(0, 0, 7);
        rover.group.rotation.set(0, 0, 0);
        rover.group.scale.set(1, 1, 1);
        controls.update();
      } else if (lifecycleRef.current === 'title') {
        const angle = now * 0.00028;
        camera.position.set(Math.sin(angle) * 20, 11.5, Math.cos(angle) * 20);
        camera.lookAt(0, 2.2, 0);
        rover.group.position.set(0, Math.sin(now * 0.003) * 0.08, 7);
        rover.group.rotation.set(0, 0, 0);
      } else if (lifecycleRef.current === 'playing') {
        if (hitstopTimer > 0) {
          hitstopTimer -= dt;
        } else {
          // Player movement (WASD / Arrow keys)
          let moveX = 0;
          let moveZ = 0;
          if (keys.has('KeyA') || keys.has('ArrowLeft')) moveX -= 1;
          if (keys.has('KeyD') || keys.has('ArrowRight')) moveX += 1;
          if (keys.has('KeyW') || keys.has('ArrowUp')) moveZ -= 1;
          if (keys.has('KeyS') || keys.has('ArrowDown')) moveZ += 1;

          const inputVec = new THREE.Vector3(moveX, 0, moveZ);
          if (inputVec.lengthSq() > 0) inputVec.normalize();

          if (boostCooldown > 0) boostCooldown = Math.max(0, boostCooldown - dt);
          if (boostActive > 0) boostActive = Math.max(0, boostActive - dt);
          if (invulnTimer > 0) invulnTimer = Math.max(0, invulnTimer - dt);

          if (boostBuffered && boostCooldown <= 0) {
            boostActive = 0.24;
            boostCooldown = 1.8;
            boostBuffered = false;
            playTone(680, 0.14, 'sawtooth', 0.07);
            spawnBurst(roverPos.clone().add(new THREE.Vector3(0, 0.4, 0)), 10);
          } else {
            boostBuffered = false;
          }

          const maxSpeed = boostActive > 0 ? 19.5 : 10.5;
          const accel = boostActive > 0 ? 48 : 34;
          roverVel.x = THREE.MathUtils.damp(roverVel.x, inputVec.x * maxSpeed, accel * 0.2, dt);
          roverVel.z = THREE.MathUtils.damp(roverVel.z, inputVec.z * maxSpeed, accel * 0.2, dt);

          roverPos.addScaledVector(roverVel, dt);

          // Keep inside arena & clear of central spire base
          const distFromCenter = Math.hypot(roverPos.x, roverPos.z);
          if (distFromCenter < 3.4) {
            const push = roverPos.clone().setY(0).normalize().multiplyScalar(3.4);
            roverPos.x = push.x;
            roverPos.z = push.z;
          } else if (distFromCenter > arenaRadius - 1.1) {
            const clamp = roverPos.clone().setY(0).normalize().multiplyScalar(arenaRadius - 1.1);
            roverPos.x = clamp.x;
            roverPos.z = clamp.z;
          }

          if (roverVel.lengthSq() > 0.2) {
            const targetYaw = Math.atan2(-roverVel.x, -roverVel.z);
            let diff = targetYaw - roverYaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            roverYaw += diff * Math.min(1, dt * 10);
          }

          rover.group.position.set(roverPos.x, Math.sin(now * 0.008) * 0.06, roverPos.z);
          rover.group.rotation.y = roverYaw;
          rover.group.rotation.z = THREE.MathUtils.damp(rover.group.rotation.z, -moveX * 0.18, 8, dt);

          // Squash & stretch on boost
          const stretchZ = boostActive > 0 ? 1.18 : 1;
          const squashX = boostActive > 0 ? 0.88 : 1;
          rover.group.scale.set(
            THREE.MathUtils.damp(rover.group.scale.x, squashX, 12, dt),
            1,
            THREE.MathUtils.damp(rover.group.scale.z, stretchZ, 12, dt)
          );

          // Hit flash visibility pulse when invulnerable
          rover.group.visible = invulnTimer <= 0 || Math.floor(invulnTimer * 18) % 2 === 0;

          // Spawn Energy Shards
          spawnShardTimer -= dt;
          if (spawnShardTimer <= 0) {
            const inactive = shards.find((s) => !s.active);
            if (inactive) {
              inactive.active = true;
              inactive.pos.copy(placeRandomOnArena(4.8, arenaRadius - 2.2));
              inactive.pos.y = 0.7;
              inactive.mesh.position.copy(inactive.pos);
              inactive.mesh.visible = true;
            }
            spawnShardTimer = 1.35;
          }

          // Update Shards & Pickup check
          for (const s of shards) {
            if (!s.active) continue;
            s.mesh.rotation.y += dt * 2.5;
            s.mesh.position.y = 0.7 + Math.sin(now * 0.005 + s.pos.x) * 0.14;
            if (s.pos.distanceTo(roverPos) < 1.55) {
              s.active = false;
              s.mesh.visible = false;
              score += 100 * wave;
              collectedThisWave++;
              playTone(880, 0.12, 'sine', 0.08);
              spawnBurst(s.pos, 12);

              if (collectedThisWave >= waveQuota) {
                if (wave >= 3) {
                  lifecycleRef.current = 'victory';
                  setLifecycle('victory');
                  submitScore(score, wave);
                  playTone(980, 0.35, 'triangle', 0.1);
                } else {
                  wave++;
                  collectedThisWave = 0;
                  waveQuota = 6 + wave * 2;
                  activateWaveDrones(wave);
                  playTone(720, 0.25, 'triangle', 0.09);
                }
              }
            }
          }

          // Update Chaser Drones
          for (const d of drones) {
            if (!d.active) continue;
            const toPlayer = new THREE.Vector3().subVectors(roverPos, d.pos).setY(0);
            if (toPlayer.lengthSq() > 0.01) toPlayer.normalize();
            d.pos.addScaledVector(toPlayer, d.speed * dt);
            d.group.position.copy(d.pos);
            d.group.rotation.y += dt * 3.2;

            if (d.pos.distanceTo(roverPos) < 1.3 && invulnTimer <= 0 && boostActive <= 0) {
              hull--;
              invulnTimer = 1.4;
              hitstopTimer = 0.045;
              shakeTimer = 0.24;
              playTone(170, 0.22, 'sawtooth', 0.11);
              spawnBurst(roverPos.clone().add(new THREE.Vector3(0, 0.5, 0)), 16);
              d.pos.copy(placeRandomOnArena(11, arenaRadius - 2));
              d.pos.y = 0.75;
              if (hull <= 0) {
                lifecycleRef.current = 'gameover';
                setLifecycle('gameover');
                submitScore(score, wave);
              }
            }
          }

          // Update Windup-Telegraphed Pulse Mines
          spawnMineTimer -= dt;
          if (spawnMineTimer <= 0) {
            const inactiveMine = mines.find((m) => !m.active);
            if (inactiveMine) {
              inactiveMine.active = true;
              inactiveMine.timer = 1.8;
              inactiveMine.pos.copy(roverPos).setY(0.35);
              inactiveMine.group.position.copy(inactiveMine.pos);
              inactiveMine.group.visible = true;
            }
            spawnMineTimer = Math.max(1.6, 3.6 - wave * 0.55);
          }

          for (const m of mines) {
            if (!m.active) continue;
            m.timer -= dt;
            const progress = 1 - Math.max(0, m.timer) / 1.8;
            m.ring.scale.setScalar(0.4 + progress * 0.75);
            if (m.timer <= 0) {
              m.active = false;
              m.group.visible = false;
              spawnBurst(m.pos, 14);
              if (m.pos.distanceTo(roverPos) < 2.25 && invulnTimer <= 0 && boostActive <= 0) {
                hull--;
                invulnTimer = 1.4;
                hitstopTimer = 0.045;
                shakeTimer = 0.24;
                playTone(150, 0.24, 'sawtooth', 0.11);
                if (hull <= 0) {
                  lifecycleRef.current = 'gameover';
                  setLifecycle('gameover');
                  submitScore(score, wave);
                }
              }
            }
          }
        }

        // Update pooled particles
        for (const p of particles) {
          if (p.life <= 0) continue;
          p.life -= dt;
          if (p.life <= 0) {
            p.mesh.visible = false;
            continue;
          }
          p.mesh.position.addScaledVector(p.vel, dt);
          p.vel.y -= 9.5 * dt;
          p.mesh.scale.setScalar(p.life / p.maxLife);
        }

        // Follow Camera + damped shake
        const desiredCam = new THREE.Vector3(roverPos.x * 0.55, 13.5, roverPos.z * 0.55 + 14.5);
        if (shakeTimer > 0) {
          shakeTimer = Math.max(0, shakeTimer - dt);
          desiredCam.x += (Math.random() - 0.5) * 0.7;
          desiredCam.y += (Math.random() - 0.5) * 0.5;
        }
        camera.position.lerp(desiredCam, Math.min(1, dt * 5.5));
        camera.lookAt(roverPos.x * 0.45, 0.6, roverPos.z * 0.45);

        const boostReady = Math.round(((1.8 - boostCooldown) / 1.8) * 100);
        setHud({ score, wave, hull, boostReady });
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        frameHandle = afterDraw(tick);
      } else {
        frameHandle = requestAnimationFrame(tick);
      }
    };

    if (isSoftwareGl) {
      frameHandle = afterDraw(tick);
    } else {
      frameHandle = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameHandle);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      gridTex.dispose();
      floorMat.dispose();
      crystalGeo.dispose();
      crystalMat.dispose();
      shardGeo.dispose();
      shardMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [playTone, submitScore]);

  return (
    <div className="fixed inset-0 z-40 bg-[#060a17] select-none overflow-hidden">
      {/* Isolated WebGL Mount (Never apply backdrop-filter over canvas) */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Top HUD Overlay (Minimal, tabular-nums, pointer-events-none wrapper) */}
      <div className="pointer-events-none fixed top-0 left-0 right-0 z-20 p-4 flex items-center justify-between gap-4">
        <div className="pointer-events-auto flex items-center gap-2 bg-[#090d1c]/92 border border-white/15 rounded-xl px-3 py-1.5">
          <button
            type="button"
            onClick={() => {
              setSceneMode('game');
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
              sceneMode === 'game' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            Arcade Game
          </button>
          <button
            type="button"
            onClick={() => {
              setSceneMode('studio');
              setDockOpen(true);
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
              sceneMode === 'studio' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            3D Studio
          </button>
        </div>

        {sceneMode === 'game' && lifecycle !== 'title' && (
          <div className="flex items-center gap-5 bg-[#090d1c]/92 border border-white/15 rounded-xl px-4 py-1.5 font-mono-tabular text-xs">
            <span className="text-slate-300">
              SCORE <strong className="text-cyan-300 ml-1">{hud.score}</strong>
            </span>
            <span className="text-slate-300">
              WAVE <strong className="text-violet-300 ml-1">{hud.wave}/3</strong>
            </span>
            <span className="text-slate-300">
              HULL <strong className="text-emerald-300 ml-1">{hud.hull}</strong>
            </span>
            <span className="text-slate-300">
              BOOST <strong className="text-amber-300 ml-1">{hud.boostReady}%</strong>
            </span>
          </div>
        )}

        <div className="pointer-events-auto flex items-center gap-2">
          {sceneMode === 'game' && lifecycle === 'playing' && (
            <button
              type="button"
              onClick={() => setLifecycle('paused')}
              aria-label="Pause Game"
              className="h-9 w-9 rounded-xl bg-[#090d1c]/92 border border-white/15 text-slate-200 hover:text-white flex items-center justify-center cursor-pointer"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setSoundMuted((m) => !m)}
            aria-label={soundMuted ? 'Unmute Audio' : 'Mute Audio'}
            className="h-9 w-9 rounded-xl bg-[#090d1c]/92 border border-white/15 text-slate-200 hover:text-white flex items-center justify-center cursor-pointer"
          >
            {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onExit}
            className="h-9 px-3 rounded-xl bg-[#090d1c]/92 border border-white/15 text-xs font-medium text-slate-200 hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
          >
            <X className="w-4 h-4" />
            Exit 3D
          </button>
        </div>
      </div>

      {/* Title Screen Overlay (Live 3D arena pan + crisp SVG title + Start CTA + flat controls hint) */}
      {sceneMode === 'game' && lifecycle === 'title' && (
        <div className="pointer-events-none fixed inset-0 z-10 flex flex-col items-center justify-between py-20 px-6">
          <div className="text-center space-y-2 mt-4">
            <svg
              viewBox="0 0 420 68"
              className="w-[320px] md:w-[420px] mx-auto"
              role="img"
              aria-label="STARFORGE DRIFT"
            >
              <text
                x="210"
                y="46"
                textAnchor="middle"
                fill="#f8fafc"
                fontSize="36"
                fontWeight="800"
                letterSpacing="6"
                fontFamily="Plus Jakarta Sans, system-ui, sans-serif"
              >
                STARFORGE DRIFT
              </text>
              <line x1="90" y1="60" x2="330" y2="60" stroke="#22d3ee" strokeWidth="2.5" />
            </svg>
          </div>

          <div className="pointer-events-auto flex flex-col items-center gap-5">
            <button
              type="button"
              onClick={startGame}
              className="h-12 px-8 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-[#050914] font-display font-bold text-sm tracking-wide inline-flex items-center gap-2 cursor-pointer shadow-[0_0_24px_rgba(34,211,238,0.4)] transition-colors"
            >
              <Play className="w-4 h-4 fill-current" />
              Start Mission
            </button>

            <p className="text-xs text-slate-400 font-mono-tabular">
              WASD Move · Space Boost · Esc Pause · H Studio Dock
            </p>

            {leaderboard.length > 0 && (
              <div className="bg-[#090d1c]/92 border border-white/15 rounded-xl px-4 py-3 min-w-[260px] space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
                  <Trophy className="w-3.5 h-3.5" />
                  PostgreSQL Leaderboard
                </div>
                {leaderboard.slice(0, 3).map((entry, idx) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between text-xs text-slate-300 font-mono-tabular"
                  >
                    <span>
                      {idx + 1}. @{entry.username}
                    </span>
                    <span className="text-cyan-300">{entry.score}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pause / Victory / Game Over Modal */}
      {sceneMode === 'game' &&
        (lifecycle === 'paused' || lifecycle === 'victory' || lifecycle === 'gameover') && (
          <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#050814]/65">
            <div className="w-full max-w-sm rounded-2xl bg-[#090d1c] border border-white/15 p-6 text-center space-y-4">
              <h2 className="text-xl font-display font-bold text-white">
                {lifecycle === 'paused'
                  ? 'Mission Paused'
                  : lifecycle === 'victory'
                    ? 'Sector Cleared!'
                    : 'Hull Breached'}
              </h2>
              <div className="flex justify-center gap-6 font-mono-tabular text-sm">
                <div>
                  <span className="text-[11px] text-slate-400 block">SCORE</span>
                  <strong className="text-cyan-300">{hud.score}</strong>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">WAVE</span>
                  <strong className="text-violet-300">{hud.wave}</strong>
                </div>
              </div>
              {scoreSaved && (
                <p className="text-xs text-emerald-300">Score saved to Cloud SQL leaderboard.</p>
              )}
              <div className="flex gap-2.5 pt-2">
                {lifecycle === 'paused' && (
                  <button
                    type="button"
                    onClick={() => setLifecycle('playing')}
                    className="flex-1 h-10 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-[#050914] font-semibold text-xs cursor-pointer"
                  >
                    Resume
                  </button>
                )}
                <button
                  type="button"
                  onClick={startGame}
                  className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {lifecycle === 'paused' ? 'Restart' : 'Play Again'}
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Collapsible Compact Bottom Studio Dock (<=15% viewport height) */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 w-[92%] max-w-3xl">
        <button
          type="button"
          onClick={() => setDockOpen((o) => !o)}
          className="px-3 py-1 rounded-lg bg-[#090d1c]/92 border border-white/15 text-[11px] text-slate-300 hover:text-white inline-flex items-center gap-1 cursor-pointer"
        >
          {dockOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          {sceneMode === 'studio' ? 'Studio Inspector (H)' : 'Arena Controls (H)'}
        </button>

        {dockOpen && (
          <div className="w-full rounded-2xl bg-[#090d1c]/94 border border-white/15 px-4 py-2.5 flex flex-wrap items-center justify-between gap-4">
            {/* Exploded View Slider (active in Studio mode) */}
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] text-slate-400">Explode</span>
              <input
                type="range"
                min={0}
                max={1.4}
                step={0.05}
                disabled={sceneMode !== 'studio'}
                value={explodeTarget}
                onChange={(e) => setExplodeTarget(Number(e.target.value))}
                className="w-24 accent-cyan-400 disabled:opacity-40"
              />
            </div>

            {/* Finish Swatches */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 mr-1">Finish</span>
              {(Object.keys(FINISH_PALETTES) as FinishKey[]).map((fk) => (
                <button
                  key={fk}
                  type="button"
                  title={FINISH_PALETTES[fk].label}
                  onClick={() => setFinishKey(fk)}
                  style={{ backgroundColor: FINISH_PALETTES[fk].hex }}
                  className={`w-5 h-5 rounded-md cursor-pointer border-2 ${
                    finishKey === fk ? 'border-white scale-110' : 'border-transparent opacity-70'
                  }`}
                />
              ))}
            </div>

            {/* Lighting Presets */}
            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'nebula', label: 'Nebula' },
                  { id: 'noon', label: 'Orbital' },
                  { id: 'storm', label: 'Ion' },
                ] as const
              ).map((lp) => (
                <button
                  key={lp.id}
                  type="button"
                  onClick={() => setLightingKey(lp.id)}
                  className={`px-2 py-1 rounded-md text-[11px] cursor-pointer ${
                    lightingKey === lp.id
                      ? 'bg-violet-600 text-white'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  {lp.label}
                </button>
              ))}
            </div>

            {/* Camera Presets in Studio */}
            {sceneMode === 'studio' && (
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'hero', label: 'Hero' },
                    { id: 'top', label: 'Top' },
                    { id: 'low', label: 'Low' },
                  ] as const
                ).map((cam) => (
                  <button
                    key={cam.id}
                    type="button"
                    onClick={() => cameraPresetCallbackRef.current?.(cam.id)}
                    className="px-2 py-1 rounded-md text-[11px] bg-white/5 hover:bg-white/10 text-slate-200 cursor-pointer"
                  >
                    {cam.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
