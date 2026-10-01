import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

/* ═══════════════════════════════════════════════════
   INIT — feature detection, GSAP, Lenis
═══════════════════════════════════════════════════ */
gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true, limitCallbacks: true });
gsap.config({ force3D: true });

const PFX = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOB = window.matchMedia('(max-width: 768px)').matches;
const LOW = MOB || (navigator.hardwareConcurrency ?? 4) <= 4;

const lenis = new Lenis({
    lerp:            0.1,   // direct lerp — instant, buttery-smooth feedback
    easing:          t => 1 - Math.pow(1 - t, 5),
    smoothWheel:     !PFX,
    smoothTouch:     false,
    wheelMultiplier: 1.22,
    touchMultiplier: 1.65,
});
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add(time => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);

/* ═══════════════════════════════════════════════════
   RENDERER
═══════════════════════════════════════════════════ */
const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 0, 6);

const renderer = new THREE.WebGLRenderer({
    antialias:       !LOW,
    alpha:           false,
    powerPreference: 'high-performance',
    stencil:         false,
    depth:           true,
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace   = THREE.SRGBColorSpace;
renderer.toneMapping        = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.info.autoReset     = false;
renderer.setClearColor(0x000000, 1.0); // true void — pure black
document.getElementById('webgl-container').appendChild(renderer.domElement);

const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

/* ═══════════════════════════════════════════════════
   DEEP SPACE BACKGROUND — JWST-GRADE PROCEDURAL
   Layer 0: Radial void gradient quad   (z = -300)
   Layer 1: 3 FBM nebula planes         (z = -200 / -240 / -280)
   Layer 2: 3-tier depth-stratified     (2000 + 400 + 25 Points)
   uTime shared across all layers — zero network requests
═══════════════════════════════════════════════════ */
scene.background = null;

// ONE shared time object — updated once per tick, read by all BG shaders
const uTime = { value: 0.0 };

// ── LAYER 0: VOID GRADIENT QUAD ──────────────────────────────
{
    const voidMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(800, 800),
        new THREE.ShaderMaterial({
            depthWrite: false, depthTest: false,
            vertexShader:   /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
            fragmentShader: /* glsl */`
                precision mediump float;
                varying vec2 vUv;
                void main() {
                    float r = length(vUv - 0.5) * 1.414;
                    float d = smoothstep(0.0, 1.0, r);
                    vec3 col = mix(
                        mix(vec3(0.0078,0.0078,0.031), vec3(0.0039,0.0039,0.016), min(d*2.0,1.0)),
                        vec3(0.0),
                        clamp(d*1.4-0.4, 0.0, 1.0)
                    );
                    gl_FragColor = vec4(col, 1.0);
                }
            `,
        })
    );
    voidMesh.position.z = -300;
    voidMesh.renderOrder = -10;
    scene.add(voidMesh);
}

// ── LAYER 1: FBM NEBULA PLANES ───────────────────────────────
const nebulaGroup     = new THREE.Group();
const ALL_NEBULA_MATS = [];
scene.add(nebulaGroup);

{
    // Gradient-noise + FBM + Voronoi — inlined GLSL, zero imports
    const NOISE_GLSL = /* glsl */`
        vec2 _h(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453)*2.0-1.0; }
        float _n(vec2 p){ vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f); return mix(mix(dot(_h(i),f),dot(_h(i+vec2(1,0)),f-vec2(1,0)),u.x),mix(dot(_h(i+vec2(0,1)),f-vec2(0,1)),dot(_h(i+vec2(1,1)),f-vec2(1)),u.x),u.y); }
        float fbm(vec2 p){ float v=0.0,a=0.5,fr=1.0; for(int i=0;i<6;i++){v+=a*_n(p*fr);fr*=2.17;a*=0.48;} return v*0.5+0.5; }
        float fbm2(vec2 p){ float v=0.0,a=0.5,fr=1.0; for(int i=0;i<5;i++){v+=a*_n(p*fr+vec2(44.1,88.7));fr*=2.13;a*=0.50;} return v*0.5+0.5; }
        float vor(vec2 p){ vec2 i=floor(p); float d=1.0; for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 nb=vec2(float(x),float(y)); vec2 pt=fract(sin(vec2(dot(i+nb,vec2(127.1,311.7)),dot(i+nb,vec2(269.5,183.3))))*43758.5453)*0.5+0.5; d=min(d,length(nb+pt-fract(p))); } return d; }
    `;
    const NEB_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

    const frags = [
        // Plane 1 — Warm Emission Nebula: crimson→orange + Voronoi star-forming knots
        NOISE_GLSL + /* glsl */`
            precision mediump float; uniform float uTime; varying vec2 vUv;
            void main(){
                vec2 uv=vUv+uTime*0.008;
                float n=fbm(uv*3.0), n2=fbm2(uv*3.0), vr=vor(uv*6.0);
                float cloud=clamp(n*1.6-0.55,0.0,1.0);
                float knots=clamp(1.0-vr*2.2,0.0,1.0)*clamp(n2*1.2-0.4,0.0,1.0);
                vec3 col=mix(vec3(0.102,0.020,0.031),vec3(0.165,0.039,0.016),n2);
                gl_FragColor=vec4(col, cloud*0.07+knots*0.03);
            }
        `,
        // Plane 2 — Cold Reflection Nebula: indigo→steel + dust lane inversion
        NOISE_GLSL + /* glsl */`
            precision mediump float; uniform float uTime; varying vec2 vUv;
            void main(){
                vec2 uv=vUv*1.2+vec2(100.0,50.0)+uTime*0.006;
                float n=fbm(uv*2.4), dust=fbm2(uv*5.0);
                float cloud=clamp(n*1.5-0.50,0.0,1.0)*(1.0-clamp(dust*1.2,0.0,0.6));
                vec3 col=mix(vec3(0.024,0.016,0.102),vec3(0.039,0.031,0.125),n);
                gl_FragColor=vec4(col, cloud*0.05);
            }
        `,
        // Plane 3 — Galactic Haze: warm→cool, largest scale structure
        NOISE_GLSL + /* glsl */`
            precision mediump float; uniform float uTime; varying vec2 vUv;
            void main(){
                vec2 uv=vUv+uTime*0.003;
                float n=fbm(uv*1.2);
                float cloud=clamp(n*1.8-0.65,0.0,1.0);
                vec3 col=mix(vec3(0.047,0.016,0.024),vec3(0.016,0.024,0.063),n);
                gl_FragColor=vec4(col, cloud*0.04);
            }
        `,
    ];

    [{ z:-200 },{ z:-240 },{ z:-280 }].forEach(({ z }, idx) => {
        const mat = new THREE.ShaderMaterial({
            uniforms:       { uTime },
            vertexShader:   NEB_VERT,
            fragmentShader: frags[idx],
            transparent:    true, depthWrite: false, depthTest: true,
            blending:       THREE.AdditiveBlending,
        });
        ALL_NEBULA_MATS.push(mat);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), mat);
        m.position.z = z;
        nebulaGroup.add(m);
    });
}

// ── LAYER 2: DEPTH-STRATIFIED STAR FIELD ─────────────────────
const starGroupA = new THREE.Group(); // Tier A: deep dust   z [150, 280]
const starGroupB = new THREE.Group(); // Tier B: mid-field   z [80,  160]
const starGroupC = new THREE.Group(); // Tier C: hero stars  z [60,  100]
scene.add(starGroupA, starGroupB, starGroupC);
const ALL_STAR_MATS = [];

{
    const STAR_VERT = /* glsl */`
        attribute vec3  aColor;
        attribute float aAlpha, aSize, aPhase;
        uniform   float uTime;
        varying   vec3  vCol;
        varying   float vAlpha;
        void main() {
            vCol   = aColor;
            vAlpha = aAlpha * (0.85 + 0.15 * sin(uTime * 0.5 + aPhase));
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * (300.0 / -mv.z);
            gl_Position  = projectionMatrix * mv;
        }
    `;
    const STAR_FRAG_STD = /* glsl */`
        precision mediump float;
        varying vec3 vCol; varying float vAlpha;
        void main() {
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5) discard;
            float s = 1.0 - smoothstep(0.25, 0.5, d);
            gl_FragColor = vec4(vCol, vAlpha * s);
        }
    `;
    // Hero stars: diffraction spike cross per spec
    const STAR_FRAG_HERO = /* glsl */`
        precision mediump float;
        varying vec3 vCol; varying float vAlpha;
        void main() {
            vec2  uv   = gl_PointCoord;
            float core = exp(-length(uv - 0.5) * 12.0);
            float spike = max(
                exp(-abs(uv.x-0.5)*40.0) * exp(-abs(uv.y-0.5)*8.0),
                exp(-abs(uv.y-0.5)*40.0) * exp(-abs(uv.x-0.5)*8.0)
            );
            float alpha = (core + spike * 0.3) * vAlpha;
            gl_FragColor = vec4(vCol + vec3(1.0)*core*0.18, clamp(alpha,0.0,0.85));
        }
    `;

    function buildStarTier({ count, dMin, dMax, szMin, szMax, aMin, aMax, pal, group, hero, exactPal }) {
        const pos=new Float32Array(count*3), col=new Float32Array(count*3);
        const alp=new Float32Array(count),   siz=new Float32Array(count), phs=new Float32Array(count);
        const PHI = Math.PI*(3.0-Math.sqrt(5.0));
        for (let i=0; i<count; i++) {
            const y=1.0-(i/(count-1))*2.0, rr=Math.sqrt(Math.max(0,1-y*y));
            const th=PHI*i, d=dMin+Math.random()*(dMax-dMin);
            pos[i*3]=Math.cos(th)*rr*d; pos[i*3+1]=y*d; pos[i*3+2]=Math.sin(th)*rr*d;
            alp[i]=aMin+Math.random()*(aMax-aMin);
            siz[i]=szMin+Math.random()*(szMax-szMin);
            phs[i]=Math.random()*6.2832;
            const c = exactPal ? pal[i] : pal[0|Math.random()*pal.length];
            col[i*3]=c[0]; col[i*3+1]=c[1]; col[i*3+2]=c[2];
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
        geo.setAttribute('aColor',   new THREE.BufferAttribute(col,3));
        geo.setAttribute('aAlpha',   new THREE.BufferAttribute(alp,1));
        geo.setAttribute('aSize',    new THREE.BufferAttribute(siz,1));
        geo.setAttribute('aPhase',   new THREE.BufferAttribute(phs,1));
        const mat = new THREE.ShaderMaterial({
            uniforms: { uTime },
            vertexShader: STAR_VERT,
            fragmentShader: hero ? STAR_FRAG_HERO : STAR_FRAG_STD,
            transparent: true, depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        ALL_STAR_MATS.push(mat);
        group.add(new THREE.Points(geo, mat));
    }

    // Tier A — 2000 deep dust: barely perceived, powdery deep-field texture
    buildStarTier({ count:2000, dMin:150, dMax:280, szMin:0.3, szMax:0.6,
        aMin:0.05, aMax:0.15, pal:[[0.910,0.933,1.000]], group:starGroupA });

    // Tier B — 400 mid-field: readable individuals, 60% white / 25% warm / 15% blue
    buildStarTier({ count:400, dMin:80, dMax:160, szMin:0.6, szMax:1.4,
        aMin:0.18, aMax:0.40,
        pal:[[1,1,1],[1,1,1],[1,1,1],[1,1,1],[1,1,1],[1,1,1],
             [1,0.957,0.878],[1,0.957,0.878],[1,0.957,0.878],
             [0.831,0.894,1],[0.831,0.894,1]],
        group:starGroupB });

    // Tier C — 25 hero stars: diffraction spikes, exact 10 warm / 10 white / 5 blue
    const HERO_PAL = [
        ...[...Array(10)].map(()=>[1.000,0.910,0.769]),
        ...[...Array(10)].map(()=>[1.000,1.000,1.000]),
        ...[...Array(5)].map(()=>[0.769,0.847,1.000]),
    ];
    for (let k=24;k>0;k--){ const j=0|Math.random()*(k+1); [HERO_PAL[k],HERO_PAL[j]]=[HERO_PAL[j],HERO_PAL[k]]; }
    buildStarTier({ count:25, dMin:60, dMax:100, szMin:1.8, szMax:3.2,
        aMin:0.55, aMax:0.85, pal:HERO_PAL, group:starGroupC, hero:true, exactPal:true });
}

/* ═══════════════════════════════════════════════════
   SCENE HIERARCHY
   mouseGroup  ← parallax pivot (mouse-driven)
     heroGroup ← scene content (Earth + rings + atmo)
═══════════════════════════════════════════════════ */
const mouseGroup = new THREE.Group();
scene.add(mouseGroup);
const heroGroup = new THREE.Group();
mouseGroup.add(heroGroup);

/* ═══════════════════════════════════════════════════
   EARTH — photorealistic PBR custom GLSL shader
   Day · Night (city lights HDR) · Normal · Specular
   Rayleigh scattering · rim emission for bloom
═══════════════════════════════════════════════════ */
const R       = 1.44;
const TL      = new THREE.TextureLoader();
TL.setCrossOrigin('anonymous');
const TEX_URL = 'https://threejs.org/examples/textures/planets/';

const loadTex = (f, cs) => new Promise(res => TL.load(
    TEX_URL + f,
    t => { t.anisotropy = Math.min(MAX_ANISO,8); t.colorSpace = cs;
           t.minFilter = THREE.LinearMipmapLinearFilter;
           t.magFilter = THREE.LinearFilter;
           t.generateMipmaps = true; res(t); },
    undefined, () => res(null)
));

const EU = {
    uDay:        { value: null },
    uNight:      { value: null },
    uNormal:     { value: null },
    uSpec:       { value: null },
    uLight:      { value: new THREE.Vector3(0.55, 0.38, 0.82).normalize() },
    uNightBoost: { value: 2.60 },
    uReady:      { value: 0.0  },
};

const EARTH_VERT = /* glsl */`
    varying vec2 vUv;
    varying vec3 vNW, vPW;
    void main() {
        vUv = uv;
        vNW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
    }
`;

const EARTH_FRAG = /* glsl */`
    precision highp float;
    uniform sampler2D uDay, uNight, uNormal, uSpec;
    uniform vec3  uLight;
    uniform float uNightBoost, uReady;
    varying vec2  vUv;
    varying vec3  vNW, vPW;

    vec3 perturbN(vec3 pos, vec3 N, vec3 mn) {
        vec3 q0=dFdx(pos), q1=dFdy(pos);
        vec2 s0=dFdx(vUv),  s1=dFdy(vUv);
        vec3 S = normalize(q0*s1.t - q1*s0.t);
        vec3 T = normalize(-q0*s1.s + q1*s0.s);
        return normalize(mat3(S,T,N)*mn);
    }

    void main() {
        vec3 N0 = normalize(vNW);
        vec3 mn = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
        mn.xy  *= 0.68;
        vec3 N  = perturbN(vPW, N0, mn);
        vec3 L  = normalize(uLight);
        vec3 V  = normalize(cameraPosition - vPW);
        vec3 H  = normalize(L + V);

        float NdL  = dot(N,  L);
        float NdL0 = dot(N0, L);
        float day  = smoothstep(-0.09, 0.21, NdL);

        vec3  albedo = texture2D(uDay,   vUv).rgb;
        vec3  lights = texture2D(uNight, vUv).rgb;
        float spec   = texture2D(uSpec,  vUv).r;

        // Diffuse + Blinn-Phong specular (ocean only via spec mask)
        vec3 dayLit = albedo * (max(NdL, 0.0) * 0.90 + 0.07);
        float specH = pow(max(dot(N, H), 0.0), 90.0) * spec;
        dayLit     += vec3(specH) * 0.62;

        // City lights — warm HDR (feeds UnrealBloom)
        vec3 nightLit = lights * uNightBoost * vec3(1.00, 0.88, 0.70);

        vec3 col = mix(nightLit, dayLit, day);

        // Rayleigh atmospheric scattering at the limb
        float NdV   = max(dot(N0, V), 0.0);
        float graze = pow(1.0 - NdV, 3.4);
        float sunAl = clamp(dot(normalize(reflect(-L,N0)),V), 0.0, 1.0);
        vec3 warm   = vec3(1.0, 0.46, 0.13) * pow(sunAl, 3.8) * 0.60;
        vec3 cool   = vec3(0.30, 0.52, 1.00) * graze * 0.46;
        col        += (warm + cool) * smoothstep(-0.30, 0.22, NdL0);

        // Rim emission → BloomPass threshold
        float rim  = pow(1.0 - NdV, 2.9);
        vec3  rimC = mix(vec3(1.0,0.50,0.16), vec3(0.48,0.70,1.10), day);
        col       += rimC * rim * 0.42;

        // Fallback while textures load
        col = mix(vec3(0.03,0.06,0.14), col, uReady);

        gl_FragColor = vec4(col, 1.0);
    }
`;

const earthMesh = new THREE.Mesh(
    new THREE.SphereGeometry(R, LOW ? 40 : 58, LOW ? 40 : 58),
    new THREE.ShaderMaterial({
        uniforms: EU, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG,
        extensions: { derivatives: true },
    })
);
heroGroup.add(earthMesh);

Promise.all([
    loadTex('earth_atmos_2048.jpg',    THREE.SRGBColorSpace),
    loadTex('earth_lights_2048.png',   THREE.SRGBColorSpace),
    loadTex('earth_normal_2048.jpg',   THREE.NoColorSpace),
    loadTex('earth_specular_2048.jpg', THREE.NoColorSpace),
]).then(([day, night, norm, spec]) => {
    if (day)   EU.uDay.value    = day;
    if (night) EU.uNight.value  = night;
    if (norm)  EU.uNormal.value = norm;
    if (spec)  EU.uSpec.value   = spec;
    if (day && night && norm && spec) EU.uReady.value = 1.0;
});

/* ═══════════════════════════════════════════════════
   ATMOSPHERE — THREE SHELLS
   1. Inner blue rim (light-aware Fresnel)
   2. Outer deep-blue corona (wide Fresnel)
   3. Bloom-feeder: ultra-tight HDR rim → UnrealBloom
═══════════════════════════════════════════════════ */
const ATMO_VERT = /* glsl */`
    varying vec3 vN, vE;
    void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vE = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
    }
`;

const INNER_FRAG = /* glsl */`
    precision highp float;
    uniform vec3 uLight;
    varying vec3 vN, vE;
    void main() {
        float fr  = pow(1.0 - clamp(dot(vN, vE), 0.0, 1.0), 4.0);
        float nDL = dot(normalize(vN), normalize(uLight)) * 0.5 + 0.5;
        vec3 dark  = vec3(0.20, 0.48, 1.00);
        vec3 lit   = vec3(0.58, 0.80, 1.00);
        vec3 col   = mix(dark, lit, nDL * 0.52) * fr * 0.64;
        gl_FragColor = vec4(col, fr * 0.23);
    }
`;

const OUTER_FRAG = /* glsl */`
    precision highp float;
    varying vec3 vN, vE;
    void main() {
        float fr = pow(1.0 - clamp(dot(vN, vE), 0.0, 1.0), 2.2);
        gl_FragColor = vec4(vec3(0.10, 0.26, 0.82) * fr * 0.16, fr * 0.08);
    }
`;

const BLOOM_FRAG = /* glsl */`
    precision highp float;
    varying vec3 vN, vE;
    void main() {
        float fr = pow(1.0 - clamp(dot(vN, vE), 0.0, 1.0), 6.5);
        gl_FragColor = vec4(vec3(0.55, 0.78, 1.00) * fr * 1.08, fr * 0.19);
    }
`;

[
    { r: R*1.048, frag: INNER_FRAG, unif: { uLight: EU.uLight } },
    { r: R*1.200, frag: OUTER_FRAG, unif: {} },
    { r: R*1.072, frag: BLOOM_FRAG, unif: {} },
].forEach(({ r, frag, unif }) => {
    heroGroup.add(new THREE.Mesh(
        new THREE.SphereGeometry(r, 32, 32),
        new THREE.ShaderMaterial({
            uniforms: unif, vertexShader: ATMO_VERT, fragmentShader: frag,
            side: THREE.BackSide, blending: THREE.AdditiveBlending,
            transparent: true, depthWrite: false,
        })
    ));
});

/* ═══════════════════════════════════════════════════
   TEXT SPRITE FACTORY
═══════════════════════════════════════════════════ */
function makeSprite(text, color, opts = {}) {
    const fs = opts.fontSize   ?? 80;
    const fw = opts.fontWeight ?? 900;
    const ff = opts.fontFamily ?? 'Montserrat, system-ui, sans-serif';
    const p  = 28;
    const font = `${fw} ${fs}px ${ff}`;
    const m = document.createElement('canvas').getContext('2d');
    m.font = font;
    const tw = m.measureText(text).width;
    const p2 = n => Math.pow(2, Math.ceil(Math.log2(Math.max(64, n))));
    const cw = p2(tw + p*2), ch = p2(fs + p*2);
    const c  = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // double glow pass
    ctx.shadowColor = color; ctx.shadowBlur = 24; ctx.fillStyle = color;
    ctx.fillText(text, cw*.5, ch*.5);
    ctx.shadowBlur = 9;
    ctx.fillText(text, cw*.5, ch*.5);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(MAX_ANISO, 4);
    tex.minFilter  = THREE.LinearMipmapLinearFilter;
    tex.magFilter  = THREE.LinearFilter;
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const sp = new THREE.Sprite(mat);
    sp.userData.aspect = cw / ch;
    return sp;
}

/* ═══════════════════════════════════════════════════
   ORBITAL ECOSYSTEM — 8 rings, satellite-close
   TubeGeometry + gradient pulse ShaderMaterial
   Canvas sprite symbols — small, jewel-like (0.10 wu)
═══════════════════════════════════════════════════ */
const ALL_SPRITES    = [];
const ALL_RINGS      = [];
const ALL_ORBIT_MATS = [];
const orbitGroup     = new THREE.Group();
heroGroup.add(orbitGroup);

// Custom 3-D closed ellipse curve for TubeGeometry
class EllipseOrbit extends THREE.Curve {
    constructor(rx, rz) { super(); this.rx = rx; this.rz = rz; this.arcLengthDivisions = 200; }
    getPoint(t) {
        const a = t * Math.PI * 2;
        return new THREE.Vector3(this.rx * Math.cos(a), 0, this.rz * Math.sin(a));
    }
}

const RING_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const RING_FRAG = /* glsl */`
    precision mediump float;
    uniform vec3  uColor0, uColor1;
    uniform float uTime, uPulseSpeed, uOpacity;
    varying vec2  vUv;
    void main() {
        // Gradient cycles 3× along the tube for colour detail
        vec3 base  = mix(uColor0, uColor1, fract(vUv.x * 3.0));
        // Travelling energy pulse — bright spot at 2× ring rotation speed
        float pos  = fract(uTime * uPulseSpeed);
        float d    = abs(fract(vUv.x - pos + 0.5) - 0.5);
        float pulse = exp(-d * d * 6000.0);
        // HDR colour spike: can exceed bloom threshold 0.95 at peak
        vec3 col   = base * 1.6 + uColor1 * 2.0 * pulse;
        gl_FragColor = vec4(col, (0.65 + pulse * 0.25) * uOpacity);
    }
`;

// Ring specification table — follows spec exactly
// { r, inc°, spd rad/s, tube, c0, c1, syms[2], exc[rx,rz] }
const RING_SPECS = [
    { r:1.22, inc: 12, spd:0.022, tube:0.003, c0:'#FF2D1A', c1:'#FF6B35', syms:['$' ,'€' ], exc:[1.00,1.00] },
    { r:1.35, inc: 38, spd:0.031, tube:0.004, c0:'#FFB347', c1:'#FFE08A', syms:['₿' ,'¥' ], exc:[1.00,0.92] },
    { r:1.48, inc: 67, spd:0.018, tube:0.003, c0:'#FF2D1A', c1:'#FFB347', syms:['£' ,'Au'], exc:[1.00,1.00] },
    { r:1.58, inc: 95, spd:0.027, tube:0.005, c0:'#FFE08A', c1:'#FFFFFF', syms:['</>','{}'], exc:[1.00,1.00] },
    { r:1.70, inc:125, spd:0.014, tube:0.003, c0:'#FF6B35', c1:'#FF2D1A', syms:['λ' ,'∞' ], exc:[0.94,1.00] },
    { r:1.82, inc:155, spd:0.035, tube:0.004, c0:'#FFB347', c1:'#FF6B35', syms:['Σ' ,'Δ' ], exc:[1.00,1.00] },
    { r:1.92, inc: 50, spd:0.020, tube:0.003, c0:'#FFFFFF', c1:'#FFE08A', syms:['₹' ,'₩' ], exc:[1.00,0.96] },
    { r:2.05, inc:140, spd:0.025, tube:0.004, c0:'#FF2D1A', c1:'#FFE08A', syms:['#' ,'&' ], exc:[1.00,1.00] },
];

RING_SPECS.forEach((spec, i) => {
    const grp  = new THREE.Group();
    const col0 = new THREE.Color(spec.c0);
    const col1 = new THREE.Color(spec.c1);
    // Pulse: 2× ring angular speed converted to UV rotations/sec
    const pulseSpeed = spec.spd * 2.0 / (Math.PI * 2.0);

    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uColor0:     { value: col0 },
            uColor1:     { value: col1 },
            uTime,
            uPulseSpeed: { value: pulseSpeed },
            uOpacity:    { value: 1.0 },
        },
        vertexShader: RING_VERT, fragmentShader: RING_FRAG,
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    ALL_ORBIT_MATS.push(mat);

    const curve = new EllipseOrbit(spec.r * spec.exc[0], spec.r * spec.exc[1]);
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 128, spec.tube, 6, true), mat));

    // Two symbols placed ≈ π apart ± small random offset
    spec.syms.forEach((text, si) => {
        const baseTheta = Math.random() * Math.PI * 2;
        const theta = baseTheta + si * (Math.PI + (Math.random() - 0.5) * 0.6);
        const lx = spec.r * spec.exc[0] * Math.cos(theta);
        const lz = spec.r * spec.exc[1] * Math.sin(theta);

        // Glowing orbital node
        const node = new THREE.Mesh(
            new THREE.SphereGeometry(0.018, 6, 6),
            new THREE.MeshBasicMaterial({
                color: col1.clone().multiplyScalar(6.0),
                blending: THREE.AdditiveBlending, depthWrite: false,
            })
        );
        node.position.set(lx, 0, lz);
        grp.add(node);

        // Canvas sprite — scale 0.10 world units: small, precious, jewel-like
        const sp = makeSprite(text, spec.c0, { fontSize: 72, fontWeight: 900 });
        sp.position.set(lx * 1.12, 0.03, lz * 1.12);
        const sc = 0.10;
        sp.scale.set(sc * sp.userData.aspect, sc, 1);
        grp.add(sp);
        ALL_SPRITES.push(sp);
    });

    const inclRad = THREE.MathUtils.degToRad(spec.inc);
    const baseZ   = (Math.random() - 0.5) * 0.14;
    grp.rotation.x          = inclRad;
    grp.rotation.z          = baseZ;
    grp.userData.spd        = spec.spd;
    grp.userData.baseInclX  = inclRad;
    grp.userData.baseInclZ  = baseZ;
    grp.userData.symbols    = [];   // reserved for banking (sphere nodes are symmetric)
    orbitGroup.add(grp);
    ALL_RINGS.push(grp);
});

// ── SCROLL-DRIVEN OPACITY FADEOUT ────────────────────────────
// Orbits:  0.25→0.60 (1→0.3), 0.60→0.80 (0.3→0), >0.80 invisible
// Nebulae: >0.90 invisible
ScrollTrigger.create({
    trigger: 'body', start: 'top top', end: 'bottom bottom',
    onUpdate: self => {
        const p = self.progress;
        if (p > 0.80) { orbitGroup.visible = false; }
        else {
            orbitGroup.visible = true;
            let op = 1.0;
            if      (p > 0.60) op = 0.3 * (1.0 - (p - 0.60) / 0.20);
            else if (p > 0.25) op = 1.0 - (p - 0.25) / 0.35 * 0.70;
            ALL_ORBIT_MATS.forEach(m => { m.uniforms.uOpacity.value = op; });
        }
        nebulaGroup.visible = p < 0.90;
    },
});

/* ═══════════════════════════════════════════════════
   POST-PROCESSING — UnrealBloom → ACES → OutputPass
═══════════════════════════════════════════════════ */
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    0.15,   // strength  — extremely subtle; only accent highlights glow
    0.52,   // radius
    0.95    // threshold — only genuine HDR spikes trigger bloom
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

/* ═══════════════════════════════════════════════════
   GLOBAL MOUSE — cursor + globe parallax + sky parallax
═══════════════════════════════════════════════════ */
const dotEl  = document.getElementById('cursorDot');
const ringEl = document.getElementById('cursorRing');
const glowEl = document.getElementById('cursor-glow');

// Centre each element on cursor using GSAP xPercent/yPercent
gsap.set([dotEl, ringEl, glowEl], { xPercent: -50, yPercent: -50, x: -500, y: -500 });

if (!PFX) {
    const qDotX = gsap.quickTo(dotEl,  'x', { duration: 0.04, ease: 'none'       });
    const qDotY = gsap.quickTo(dotEl,  'y', { duration: 0.04, ease: 'none'       });
    const qRngX = gsap.quickTo(ringEl, 'x', { duration: 0.26, ease: 'power3.out' });
    const qRngY = gsap.quickTo(ringEl, 'y', { duration: 0.26, ease: 'power3.out' });
    const qGlwX = gsap.quickTo(glowEl, 'x', { duration: 0.68, ease: 'power3.out' });
    const qGlwY = gsap.quickTo(glowEl, 'y', { duration: 0.68, ease: 'power3.out' });
    // Globe parallax — dominant, faster
    const qRotY = gsap.quickTo(mouseGroup.rotation, 'y', { duration: 0.92, ease: 'power3.out' });
    const qRotX = gsap.quickTo(mouseGroup.rotation, 'x', { duration: 0.92, ease: 'power3.out' });
    // Sky parallax — via camera tilt, slow and subtle
    const qCamY = gsap.quickTo(camera.rotation, 'y', { duration: 1.60, ease: 'power3.out' });
    const qCamX = gsap.quickTo(camera.rotation, 'x', { duration: 1.60, ease: 'power3.out' });

    window.addEventListener('mousemove', e => {
        const nx = e.clientX / innerWidth  - 0.5;
        const ny = e.clientY / innerHeight - 0.5;
        qDotX(e.clientX); qDotY(e.clientY);
        qRngX(e.clientX); qRngY(e.clientY);
        qGlwX(e.clientX); qGlwY(e.clientY);
        qRotY( nx * 0.27);   qRotX( ny * 0.16);   // globe parallax
        qCamY(-nx * 0.048);  qCamX( ny * 0.028);  // sky parallax (subtle)
        mouseNorm.x = nx; mouseNorm.y = -ny;       // star tier parallax
    }, { passive: true });

    document.querySelectorAll('button, a').forEach(el => {
        el.addEventListener('mouseenter', () => ringEl.classList.add('hover'));
        el.addEventListener('mouseleave', () => ringEl.classList.remove('hover'));
    });
}

/* ═══════════════════════════════════════════════════
   RESIZE
═══════════════════════════════════════════════════ */
let resizeRAF;
window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(() => {
        const w = innerWidth, h = innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        composer.setSize(w, h);
        composer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        bloomPass.setSize(w, h);
    });
});

/* ═══════════════════════════════════════════════════
   RENDER LOOP
═══════════════════════════════════════════════════ */
const clock = new THREE.Clock();
let live = true, elapsed = 0.0;
const mouseNorm = { x: 0, y: 0 };  // star-tier parallax target
// Pre-allocated helpers for symbol banking
const _fwd  = new THREE.Vector3(0, 0, 1);
const _tan  = new THREE.Vector3();
const _qTgt = new THREE.Quaternion();

document.addEventListener('visibilitychange', () => {
    live = !document.hidden;
    if (live) { clock.start(); requestAnimationFrame(tick); }
});

function tick() {
    if (!live) return;
    const dt = Math.min(clock.getDelta(), 0.0333); // cap at 33ms / ~30fps
    elapsed += dt;
    uTime.value = elapsed; // single update for all BG + ring shaders

    // Orbital rings — wobble + rotation
    ALL_RINGS.forEach((ring, i) => {
        ring.rotation.y += dt * ring.userData.spd;
        // 3-harmonic stacked wobble, golden-ratio phase offset per ring
        const ph = i * 1.618;
        const wX = Math.sin(elapsed * 0.31 + ph)        * 0.018
                 + Math.sin(elapsed * 0.73 + ph * 2.0)  * 0.009
                 + Math.sin(elapsed * 1.19 + ph * 3.0)  * 0.004;
        const wZ = Math.cos(elapsed * 0.27 + ph)        * 0.014
                 + Math.cos(elapsed * 0.61 + ph * 1.7)  * 0.007
                 + Math.cos(elapsed * 1.07 + ph * 2.3)  * 0.003;
        ring.rotation.x = ring.userData.baseInclX + wX;
        ring.rotation.z = ring.userData.baseInclZ + wZ;
        // Symbol banking via FPS-independent quaternion slerp
        const lf = 1.0 - Math.pow(0.001, dt);
        ring.userData.symbols?.forEach(sym => {
            const wt = sym.theta + ring.rotation.y;
            _tan.set(-Math.sin(wt), 0, Math.cos(wt)).normalize();
            _qTgt.setFromUnitVectors(_fwd, _tan);
            sym.node.quaternion.slerp(_qTgt, lf);
        });
    });

    // Star tier parallax — each tier at a different lag factor
    starGroupA.position.x += (mouseNorm.x * 4.0  - starGroupA.position.x) * 0.025;
    starGroupA.position.y += (mouseNorm.y * 2.5  - starGroupA.position.y) * 0.025;
    starGroupB.position.x += (mouseNorm.x * 8.0  - starGroupB.position.x) * 0.035;
    starGroupB.position.y += (mouseNorm.y * 5.0  - starGroupB.position.y) * 0.035;
    starGroupC.position.x += (mouseNorm.x * 14.0 - starGroupC.position.x) * 0.045;
    starGroupC.position.y += (mouseNorm.y * 8.0  - starGroupC.position.y) * 0.045;

    composer.render();
    requestAnimationFrame(tick);
}

/* ═══════════════════════════════════════════════════
   HERO TEXT — EXACT CHOREOGRAPHY
   "UR LIFE"  → slide  UP  from below clip boundary
   "IS"       → slide  UP  from below (staggered)
   "UP"       → drop  DOWN from above clip boundary (last)
                + premium gold glow pulsation on arrival
═══════════════════════════════════════════════════ */
gsap.set('[data-slide="up"]',   { yPercent:  115, opacity: 0 });
gsap.set('[data-slide="down"]', { yPercent: -115, opacity: 0 });
gsap.set('.hero-sub',           { opacity: 0, y: 20 });

function startSite() {
    document.getElementById('loader').classList.add('hidden');
    requestAnimationFrame(tick);

    const tl = gsap.timeline({ delay: 0.20 });

    // "UR LIFE" then "IS" — slide up from below the clip mask
    tl.to('[data-slide="up"]', {
        yPercent: 0,
        opacity:  1,
        duration: 1.14,
        stagger:  0.17,
        ease:     'power4.out',
    });

    // "UP" — drops down from above into place
    tl.to('[data-slide="down"]', {
        yPercent: 0,
        opacity:  1,
        duration: 1.08,
        ease:     'expo.out',
    }, '-=0.58');

    // Subtitle rises in
    tl.to('.hero-sub', {
        opacity: 1,
        y:       0,
        duration: 0.88,
        ease:    'power3.out',
    }, '-=0.40');

    // Activate UP word glow after it lands
    tl.call(() => {
        document.querySelector('.up-word').classList.add('glowing');
    }, null, '-=0.20');
}

if (document.fonts?.ready) document.fonts.ready.then(startSite);
else                       window.addEventListener('load', startSite);

/* ═══════════════════════════════════════════════════
   SCROLL → EARTH ROTATION → EGYPT
   Cairo: lat 30.04°N, lon 31.23°E
   At scroll bottom the globe lands precisely on Egypt.
═══════════════════════════════════════════════════ */
const EGYPT_ROT_X =  THREE.MathUtils.degToRad(30.04);
const EGYPT_ROT_Y = -Math.PI / 2 - THREE.MathUtils.degToRad(31.23);

gsap.to(earthMesh.rotation, {
    x: EGYPT_ROT_X,
    y: EGYPT_ROT_Y,
    ease: 'none',
    scrollTrigger: {
        trigger:       'body',
        start:         'top top',
        end:           'bottom bottom',
        scrub:         0.1,
        anticipatePin: 1,
        fastScrollEnd: true,
    },
});

/* ═══════════════════════════════════════════════════
   ORB STAGE POSES — cinematic globe glide per section
═══════════════════════════════════════════════════ */
const POSES = {
    hero:   { px:  0.00, py:  0.00, pz:  0.00, rz:  0,               s: 1.00 },
    left:   { px:  3.10, py:  0.18, pz: -0.55, rz:  Math.PI * 0.20,  s: 0.82 },
    right:  { px: -3.10, py: -0.18, pz: -0.55, rz: -Math.PI * 0.20,  s: 0.94 },
    center: { px:  0.00, py:  0.00, pz:  1.55, rz:  0,               s: 1.32 },
};
const pOpts = { duration: 1.45, ease: 'power3.inOut', overwrite: 'auto' };

function toPose(p) {
    gsap.to(heroGroup.position, { x: p.px, y: p.py, z: p.pz, ...pOpts });
    gsap.to(heroGroup.rotation, { z: p.rz, ...pOpts });
    gsap.to(heroGroup.scale,    { x: p.s,  y: p.s,  z: p.s,  ...pOpts });
}

[
    { sel: '[data-scene="hero"]',   pose: POSES.hero   },
    { sel: '[data-scene="left"]',   pose: POSES.left   },
    { sel: '[data-scene="right"]',  pose: POSES.right  },
    { sel: '[data-scene="center"]', pose: POSES.center },
].forEach(({ sel, pose }) => ScrollTrigger.create({
    trigger: sel, start: 'top center', end: 'bottom center',
    onEnter: () => toPose(pose), onEnterBack: () => toPose(pose),
}));

// Fade ring sprites at CTA to reveal clean Earth over Egypt
ScrollTrigger.create({
    trigger: '[data-scene="center"]', start: 'top 80%',
    onEnter:     () => ALL_SPRITES.forEach(sp => gsap.to(sp.material, { opacity: 0, duration: 1.0 })),
    onLeaveBack: () => ALL_SPRITES.forEach(sp => gsap.to(sp.material, { opacity: 1, duration: 0.8 })),
});

/* ═══════════════════════════════════════════════════
   SECTION CONTENT REVEALS
═══════════════════════════════════════════════════ */
gsap.utils.toArray('[data-scene="left"] .reveal, [data-scene="right"] .reveal').forEach(el => {
    const isL = el.closest('[data-scene]').dataset.scene === 'left';
    gsap.fromTo(el,
        { x: isL ? -88 : 88, opacity: 0, filter: 'blur(12px)' },
        { x: 0, opacity: 1, filter: 'blur(0px)', duration: 1.2, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 80%', toggleActions: 'play none none reverse' } }
    );
});

gsap.to('[data-scene="center"] .reveal', {
    opacity: 1, duration: 0.7,
    scrollTrigger: { trigger: '[data-scene="center"]', start: 'top 84%' },
});

gsap.from('[data-cta-heading]', {
    scale: 0.78, opacity: 0, duration: 1.1, ease: 'back.out(1.4)',
    scrollTrigger: { trigger: '[data-cta-heading]', start: 'top 84%', toggleActions: 'play none none reverse' },
});
gsap.from('[data-cta-sub]', {
    y: 36, opacity: 0, duration: 0.9, delay: 0.13, ease: 'power3.out',
    scrollTrigger: { trigger: '[data-cta-sub]', start: 'top 84%', toggleActions: 'play none none reverse' },
});
gsap.from('[data-cta-btn]', {
    y: 26, opacity: 0, scale: 0.88, duration: 0.9, delay: 0.26, ease: 'back.out(1.5)',
    scrollTrigger: { trigger: '[data-cta-btn]', start: 'top 90%', toggleActions: 'play none none reverse' },
});

/* ═══════════════════════════════════════════════════
   DOM PARALLAX ON PANELS & HERO
═══════════════════════════════════════════════════ */
gsap.utils.toArray('[data-parallax]').forEach(el => {
    const s = parseFloat(el.dataset.parallax) || 0.14;
    gsap.to(el, {
        y: () => -innerHeight * s, ease: 'none',
        scrollTrigger: {
            trigger: el.closest('.section'),
            start: 'top bottom', end: 'bottom top', scrub: true,
        },
    });
});

/* ═══════════════════════════════════════════════════
   PROGRESS BAR + SCROLL HINT
═══════════════════════════════════════════════════ */
ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: self => {
        document.getElementById('progressBar').style.width = (self.progress * 100) + '%';
    },
});
ScrollTrigger.create({
    trigger: '[data-scene="left"]', start: 'top 92%',
    onEnter:     () => gsap.to('#scrollHint', { opacity: 0, duration: 0.4 }),
    onLeaveBack: () => gsap.to('#scrollHint', { opacity: 1, duration: 0.4 }),
});

/* ═══════════════════════════════════════════════════
   MEMORY DISPOSAL — full GPU resource release on unload
═══════════════════════════════════════════════════ */
function dispose() {
    live = false;
    earthMesh.geometry.dispose();
    Object.values(EU).forEach(u => { if (u.value?.isTexture) u.value.dispose(); });
    earthMesh.material.dispose();
    heroGroup.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            obj.material.map?.dispose();
            obj.material.dispose();
        }
    });
    // Star + nebula groups
    [starGroupA, starGroupB, starGroupC, nebulaGroup].forEach(grp => {
        grp.traverse(obj => {
            obj.geometry?.dispose();
            if (obj.material) { obj.material.map?.dispose(); obj.material.dispose(); }
        });
    });
    bloomPass.dispose?.();
    composer.passes.forEach(p => p.dispose?.());
    composer.renderTarget1?.dispose();
    composer.renderTarget2?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    ScrollTrigger.getAll().forEach(st => st.kill());
    lenis.destroy();
}
window.addEventListener('pagehide', dispose, { once: true });
