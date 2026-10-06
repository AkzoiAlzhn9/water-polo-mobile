// 3D-сцена: бассейн, вода, ворота, разметка, арена, трибуны, камеры, брызги.
(function () {
  const R = WP.R;
  const TINT = 'vec3(0.03,0.30,0.40)';

  // Подкрашивание частей тела под водой
  WP.underwaterify = function (mat, strength) {
    const k = (strength || 1).toFixed(2);
    mat.customProgramCacheKey = () => 'uw' + k;
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWY = (modelMatrix * vec4(transformed,1.0)).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          if (vWY < 0.02) { float kk = clamp((0.16 - vWY * 0.4) * ${k}, 0.0, 0.7); gl_FragColor.rgb = mix(gl_FragColor.rgb * vec3(0.85, 0.95, 0.98), ${TINT}, kk); }`);
    };
    return mat;
  };

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw(g, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    t.userData = { canvas: c, ctx: g };
    return t;
  }
  WP.canvasTex = canvasTex;

  const FLOOR_VS = `
    varying vec3 vW;
    void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
  const FLOOR_FS = `
    uniform float uTime; uniform int uMode; uniform vec3 uSh[16];
    varying vec3 vW;
    float caustic(vec2 uv, float time){
      vec2 p = mod(uv*6.28318, 6.28318) - 250.0;
      vec2 i = p; float c = 1.0; float inten = 0.005;
      for (int n = 0; n < 4; n++) {
        float t = time * (1.0 - (3.5 / float(n+1)));
        i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
        c += 1.0/length(vec2(p.x / (sin(i.x+t)/inten), p.y / (cos(i.y+t)/inten)));
      }
      c /= 4.0; c = 1.17 - pow(c, 1.4);
      return pow(abs(c), 8.0);
    }
    void main(){
      vec2 p = uMode == 0 ? vW.xz : (uMode == 1 ? vec2(vW.x, vW.y) : vec2(vW.z, vW.y));
      vec2 g = abs(fract(p / 0.25) - 0.5);
      float grout = smoothstep(0.455, 0.5, max(g.x, g.y));
      vec3 tile = vec3(0.60, 0.84, 0.90);
      tile = mix(tile, vec3(0.40, 0.60, 0.68), grout * 0.7);
      if (uMode == 0) {
        float lz = abs(mod(vW.z + 1.25, 2.5) - 1.25);
        float inLane = step(lz, 0.13) * step(abs(vW.x), 12.6) * step(abs(vW.z), 10.1);
        float tbar = step(abs(abs(vW.x) - 12.6), 0.13) * step(lz, 0.5) * step(abs(vW.z), 10.1);
        tile = mix(tile, vec3(0.08, 0.13, 0.24), max(inLane, tbar));
      }
      if (uMode != 0 && vW.y > -0.35) tile = mix(tile, vec3(0.12, 0.22, 0.40), 0.85);
      float cz = caustic(vW.xz * 0.22 + vec2(vW.y * 0.05), uTime * 0.55);
      float depth = uMode == 0 ? 1.0 : clamp(-vW.y / 2.2, 0.0, 1.0);
      vec3 col = tile * (0.62 + 0.75 * cz * (0.4 + 0.6 * depth));
      if (uMode == 0) {
        for (int k = 0; k < 16; k++) {
          vec3 s = uSh[k];
          if (s.z <= 0.0) continue;
          float d = length(vW.xz - s.xy);
          col *= 1.0 - 0.38 * smoothstep(s.z, s.z * 0.2, d);
        }
      }
      col = mix(col, vec3(0.03, 0.28, 0.38), 0.18 + 0.2 * depth);
      gl_FragColor = vec4(col, 1.0);
    }`;

  const WATER_VS = `
    uniform float uTime; uniform vec4 uRip[24];
    varying vec3 vW; varying vec3 vN;
    float baseH(vec2 p){
      float h = 0.0;
      h += 0.016*sin(dot(p, vec2(0.91,0.41))*1.7 + uTime*1.3);
      h += 0.011*sin(dot(p, vec2(-0.5,0.86))*2.6 + uTime*1.9);
      h += 0.006*sin(dot(p, vec2(0.2,-0.98))*4.3 + uTime*2.7);
      h += 0.004*sin(dot(p, vec2(-0.8,-0.6))*6.9 + uTime*3.6);
      return h;
    }
    float ripH(vec2 p){
      float h = 0.0;
      for (int i = 0; i < 24; i++) {
        vec4 r = uRip[i];
        if (r.w == 0.0) continue;
        float age = uTime - r.z;
        if (age < 0.0 || age > 3.5) continue;
        float d = distance(p, r.xy);
        float x = d - age * 1.5;
        h += r.w * exp(-x*x*5.0) * cos(x*8.5) * exp(-age*1.3) / (1.0 + d*1.2);
      }
      return h;
    }
    float H(vec2 p){ return baseH(p) + ripH(p); }
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      float e = 0.07;
      float h = H(w.xz);
      float hx = H(w.xz + vec2(e, 0.0));
      float hz = H(w.xz + vec2(0.0, e));
      vN = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
      w.y += h;
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`;
  const WATER_FS = `
    uniform float uTime; uniform vec3 uCam; uniform sampler2D uFoam; uniform sampler2D uFB; uniform vec2 uRes;
    varying vec3 vW; varying vec3 vN;
    void main(){
      vec2 p = vW.xz;
      vec3 N = vN;
      N.x += 0.05*sin(p.x*9.0 + uTime*2.1 + sin(p.y*7.0)) + 0.035*sin(p.y*14.0 - uTime*2.9 + p.x*3.0);
      N.z += 0.05*sin(p.y*8.0 - uTime*1.7 + sin(p.x*6.0)) + 0.035*sin(p.x*13.0 + uTime*3.3 - p.y*2.0);
      N = normalize(N);
      vec3 V = normalize(uCam - vW);
      float ndv = max(dot(N, V), 0.0);
      float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
      vec3 Rf = reflect(-V, N);
      vec3 refl = mix(vec3(0.07, 0.10, 0.15), vec3(0.34, 0.40, 0.50), smoothstep(-0.1, 0.9, Rf.y));
      if (Rf.y > 0.05) {
        vec2 c = vW.xz + Rf.xz * ((17.0 - vW.y) / Rf.y);
        float sx = abs(fract(c.x / 7.0) - 0.5);
        float sz = abs(fract(c.y / 9.0) - 0.5);
        float lamp = smoothstep(0.1, 0.02, sx) * smoothstep(0.32, 0.22, sz) * step(abs(c.y), 16.0) * step(abs(c.x), 24.0);
        refl += vec3(1.0, 0.96, 0.88) * lamp * 1.6;
      }
      vec3 L1 = normalize(vec3(0.25, 1.0, 0.35));
      vec3 L2 = normalize(vec3(-0.4, 1.0, -0.2));
      float spec = pow(max(dot(N, normalize(L1 + V)), 0.0), 220.0) * 1.3 + pow(max(dot(N, normalize(L2 + V)), 0.0), 260.0) * 0.9;
      // Преломление: берём уже отрисованную картинку под поверхностью со сдвигом по нормали волны
      float dist = length(uCam - vW);
      vec2 suv = gl_FragCoord.xy / uRes;
      vec2 off = N.xz * 0.045 / max(1.0, dist * 0.09);
      vec3 under = texture2D(uFB, clamp(suv + off, vec2(0.002), vec2(0.998))).rgb;
      // Поглощение: чем длиннее путь луча в воде до дна, тем глубже сине-зелёный тон
      vec3 vd = normalize(vW - uCam);
      float Lw = vd.y < -0.02 ? (vW.y + 2.2) / -vd.y : 25.0;
      float ab = 1.0 - exp(-Lw * 0.085);
      under = mix(under * vec3(0.84, 0.96, 1.0), vec3(0.02, 0.23, 0.31), ab * 0.6);
      vec3 col = mix(under, refl, fres) + vec3(spec);
      float a = 1.0;
      // Пена и бурун от пловцов, мяча, борьбы
      vec2 fuv = vec2((vW.x + 14.5) / 29.0, (vW.z + 11.5) / 23.0);
      float fm = texture2D(uFoam, fuv).a;
      float n1 = sin(p.x * 11.0 + sin(p.y * 7.3 + uTime * 0.8) * 2.2) * sin(p.y * 9.7 + sin(p.x * 5.1 - uTime * 0.6) * 2.0);
      float pat = 0.5 + 0.5 * n1;
      float foam = clamp(fm * (0.7 + 0.3 * pat) - 0.04, 0.0, 1.0);
      col = mix(col, vec3(0.9, 0.96, 0.99), foam * 0.7);
      gl_FragColor = vec4(col, a);
    }`;

  const PART_VS = `
    attribute float aLife; attribute float aSize;
    varying float vL;
    void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * (320.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
  const PART_FS = `
    varying float vL;
    void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; float a = smoothstep(0.5, 0.1, d) * clamp(vL, 0.0, 1.0) * 0.85; gl_FragColor = vec4(0.93, 0.97, 1.0, a); }`;

  class World {
    constructor(container) {
      const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.0;
      container.appendChild(r.domElement);
      this.canvas = r.domElement;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x09121b);
      this.scene.fog = new THREE.Fog(0x09121b, 42, 85);
      this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 220);
      this.camera.position.set(0, 10, 22);
      this.time = 0;
      this.camMode = 'tv';
      this.camFocus = new THREE.Vector3();
      this.camPos = new THREE.Vector3(0, 10, 22);
      this.camLook = new THREE.Vector3();
      this.ripples = []; for (let i = 0; i < 24; i++) this.ripples.push(new THREE.Vector4(0, 0, -99, 0));
      this.ripIdx = 0;
      this.shadowPts = []; for (let i = 0; i < 16; i++) this.shadowPts.push(new THREE.Vector3(0, 0, 0));
      this.floorMats = [];
      this.cheerT = 0;
      this.boardKey = '';

      this.buildLights();
      this.buildPool();
      this.buildWater();
      this.buildLines();
      this.goals = [this.buildGoal(-1), this.buildGoal(1)];
      this.buildArena();
      this.buildCrowd();
      this.buildBoards();
      this.buildOfficials();
      this.buildParticles();
      this.buildEnvironment();
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const w = this.canvas.parentElement.clientWidth || window.innerWidth;
      const h = this.canvas.parentElement.clientHeight || window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.fov = w / h < 1 ? 58 : 40;
      this.camera.updateProjectionMatrix();
    }

    buildLights() {
      const s = this.scene;
      s.add(new THREE.HemisphereLight(0xe6efff, 0x1d3c48, 0.6));
      const d = new THREE.DirectionalLight(0xfff6ea, 1.9);
      d.position.set(6, 20, 9);
      s.add(d);
      const d2 = new THREE.DirectionalLight(0xcfe3ff, 0.6);
      d2.position.set(-8, 14, -12);
      s.add(d2);
    }

    buildPool() {
      const s = this.scene, L = R.POOL_HALF_L, W = R.POOL_HALF_W, D = R.DEPTH;
      const mk = (mode) => {
        const m = new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uMode: { value: mode }, uSh: { value: this.shadowPts } },
          vertexShader: FLOOR_VS, fragmentShader: FLOOR_FS,
        });
        this.floorMats.push(m); return m;
      };
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(L * 2, W * 2), mk(0));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -D; s.add(floor);
      const wallX = mk(1), wallZ = mk(2);
      const h = D + 0.3;
      const w1 = new THREE.Mesh(new THREE.PlaneGeometry(L * 2, h), wallX); w1.position.set(0, -D + h / 2, -W); s.add(w1);
      const w2 = new THREE.Mesh(new THREE.PlaneGeometry(L * 2, h), wallX); w2.position.set(0, -D + h / 2, W); w2.rotation.y = Math.PI; s.add(w2);
      const w3 = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, h), wallZ); w3.position.set(-L, -D + h / 2, 0); w3.rotation.y = Math.PI / 2; s.add(w3);
      const w4 = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, h), wallZ); w4.position.set(L, -D + h / 2, 0); w4.rotation.y = -Math.PI / 2; s.add(w4);

      // Бортик и палуба
      const deckTex = canvasTex(256, 256, (g, w, hh) => {
        g.fillStyle = '#c4cbd0'; g.fillRect(0, 0, w, hh);
        g.strokeStyle = 'rgba(80,95,105,0.35)'; g.lineWidth = 3;
        for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, hh); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
        for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${100 + Math.random() * 60},${110 + Math.random() * 50},0.12)`; g.fillRect(Math.random() * w, Math.random() * hh, 2, 2); }
      });
      deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping; deckTex.repeat.set(12, 12);
      const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85 });
      const deckY = 0.3, outer = 26, outerW = 16;
      const addDeck = (x0, x1, z0, z1) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.6, z1 - z0), deckMat);
        m.position.set((x0 + x1) / 2, deckY - 0.3, (z0 + z1) / 2); s.add(m);
      };
      addDeck(-outer, outer, W, outerW + 8);
      addDeck(-outer, outer, -outerW - 2, -W);
      addDeck(-outer, -L, -W, W);
      addDeck(L, outer, -W, W);
      // Сливной желоб
      const gut = new THREE.MeshStandardMaterial({ color: 0x223a52, roughness: 0.4 });
      for (const zz of [-W, W]) { const g = new THREE.Mesh(new THREE.BoxGeometry(L * 2 + 0.3, 0.12, 0.25), gut); g.position.set(0, deckY + 0.02, zz); s.add(g); }
      for (const xx of [-L, L]) { const g = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, W * 2 + 0.3), gut); g.position.set(xx, deckY + 0.02, 0); s.add(g); }
    }

    // Отражения окружения (арена, лампы) для кожи, мяча, стоек ворот
    buildEnvironment() {
      try {
        const pm = new THREE.PMREMGenerator(this.renderer);
        this.scene.position.y = -2.5;
        this.scene.updateMatrixWorld(true);
        this.scene.environment = pm.fromScene(this.scene, 0.035, 0.1, 120).texture;
        this.scene.position.y = 0;
        this.scene.updateMatrixWorld(true);
        pm.dispose();
      } catch (e) { this.scene.position.y = 0; }
    }

    buildFoam() {
      const W = 512, H = Math.round(512 * R.POOL_HALF_W / R.POOL_HALF_L);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      this.foamCtx = c.getContext('2d');
      this.foamTex = new THREE.CanvasTexture(c);
      this.foamTex.premultiplyAlpha = false;
      this.foamScale = W / (R.POOL_HALF_L * 2);
      const sp = document.createElement('canvas'); sp.width = sp.height = 64;
      const g = sp.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      this.foamSprite = sp;
      this.foamQ = []; this.foamAcc = 0;
    }

    foam(x, z, r, a) { if (a > 0.003 && this.foamQ.length < 4000) this.foamQ.push(x, z, r, Math.min(1, a)); }

    flushFoam(dt) {
      this.foamAcc += dt;
      if (this.foamAcc < 1 / 30) return;
      const ctx = this.foamCtx, s = this.foamScale, q = this.foamQ;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,' + Math.min(0.6, this.foamAcc * 3.6).toFixed(3) + ')';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < q.length; i += 4) {
        const cx = (q[i] + R.POOL_HALF_L) * s, cy = (R.POOL_HALF_W - q[i + 1]) * s, rr = q[i + 2] * s;
        ctx.globalAlpha = q[i + 3];
        ctx.drawImage(this.foamSprite, cx - rr, cy - rr, rr * 2, rr * 2);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      q.length = 0; this.foamAcc = 0;
      this.foamTex.needsUpdate = true;
    }

    buildWater() {
      this.buildFoam();
      const geo = new THREE.PlaneGeometry(R.POOL_HALF_L * 2, R.POOL_HALF_W * 2, 150, 120);
      geo.rotateX(-Math.PI / 2);
      this.waterMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uRip: { value: this.ripples }, uCam: { value: new THREE.Vector3() }, uFoam: { value: this.foamTex }, uFB: { value: null }, uRes: { value: new THREE.Vector2(1, 1) } },
        vertexShader: WATER_VS, fragmentShader: WATER_FS,
      });
      this.water = new THREE.Mesh(geo, this.waterMat);
      this.water.renderOrder = 1;
      this.water.layers.set(1);
      this.scene.add(this.water);
    }

    waveHeight(x, z) {
      const t = this.time;
      return 0.016 * Math.sin((x * 0.91 + z * 0.41) * 1.7 + t * 1.3)
        + 0.011 * Math.sin((-x * 0.5 + z * 0.86) * 2.6 + t * 1.9)
        + 0.006 * Math.sin((x * 0.2 - z * 0.98) * 4.3 + t * 2.7);
    }

    addRipple(x, z, amp) {
      const r = this.ripples[this.ripIdx];
      r.set(x, z, this.time, amp);
      this.ripIdx = (this.ripIdx + 1) % this.ripples.length;
    }

    buildLines() {
      const s = this.scene;
      // Плавучие разделительные дорожки по бокам поля
      const step = 0.11, n = Math.round(R.HALF_L * 2 / step) + 1;
      const geo = new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10); geo.rotateZ(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
      const inst = new THREE.InstancedMesh(geo, mat, n * 2);
      const m4 = new THREE.Matrix4(), col = new THREE.Color();
      let k = 0;
      for (const zz of [-R.HALF_W, R.HALF_W]) {
        for (let i = 0; i < n; i++) {
          const x = -R.HALF_L + i * step;
          const dx = R.HALF_L - Math.abs(x);
          m4.makeTranslation(x, 0.02, zz);
          inst.setMatrixAt(k, m4);
          col.set(dx < 2 ? 0xd62828 : dx < 5 ? 0xf2c400 : dx < 6 ? 0x2a9d4a : 0xf3f3f3);
          inst.setColorAt(k, col);
          k++;
        }
      }
      s.add(inst);
      // Боковые знаки на бортике
      const marks = [[R.HALF_L, 0xffffff], [R.HALF_L - 2, 0xd62828], [R.HALF_L - 5, 0xf2c400], [R.HALF_L - 6, 0x2a9d4a], [0, 0xffffff]];
      const bgeo = new THREE.BoxGeometry(0.12, 0.7, 0.5);
      for (const [dx, c] of marks) {
        const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, emissive: c, emissiveIntensity: 0.15 });
        for (const sx of dx === 0 ? [1] : [-1, 1]) for (const zz of [-(R.POOL_HALF_W + 0.5), R.POOL_HALF_W + 0.5]) {
          const b = new THREE.Mesh(bgeo, m); b.position.set(sx * dx, 0.65, zz); s.add(b);
        }
      }
      // Зоны возвращения (дальние углы за линией ворот)
      const reMat = new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.6, emissive: 0xd62828, emissiveIntensity: 0.25 });
      for (const sx of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.6), reMat);
        plate.position.set(sx * (R.HALF_L + 1.0), 0.62, -(R.POOL_HALF_W + 0.35)); s.add(plate);
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), reMat);
        pole.position.set(sx * R.HALF_L, 0.75, -(R.POOL_HALF_W + 0.3)); s.add(pole);
      }
    }

    buildGoal(side) {
      const s = this.scene, g = new THREE.Group();
      const gx = side * R.HALF_L;
      const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
      WP.underwaterify(white, 0.8);
      const postGeo = new THREE.CylinderGeometry(R.POST_R, R.POST_R, 1.8, 12);
      for (const zz of [-R.GOAL_HALF_W - R.POST_R, R.GOAL_HALF_W + R.POST_R]) {
        const p = new THREE.Mesh(postGeo, white); p.position.set(gx, 0, zz); g.add(p);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(R.POST_R, R.POST_R, R.GOAL_HALF_W * 2 + R.POST_R * 4, 12), white);
      bar.rotation.x = Math.PI / 2; bar.position.set(gx, R.GOAL_H + R.POST_R, 0); g.add(bar);
      const back = gx + side * R.GOAL_DEPTH;
      const thin = new THREE.CylinderGeometry(0.02, 0.02, 1, 8);
      const addBar = (a, b) => {
        const m = new THREE.Mesh(thin, white);
        const d = new THREE.Vector3().subVectors(b, a); const len = d.length();
        m.scale.y = len; m.position.copy(a).addScaledVector(d, 0.5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        g.add(m);
      };
      const hw = R.GOAL_HALF_W + R.POST_R;
      addBar(new THREE.Vector3(gx, R.GOAL_H, -hw), new THREE.Vector3(back, R.GOAL_H, -hw));
      addBar(new THREE.Vector3(gx, R.GOAL_H, hw), new THREE.Vector3(back, R.GOAL_H, hw));
      addBar(new THREE.Vector3(back, R.GOAL_H, -hw), new THREE.Vector3(back, R.GOAL_H, hw));
      addBar(new THREE.Vector3(back, -0.6, -hw), new THREE.Vector3(back, R.GOAL_H, -hw));
      addBar(new THREE.Vector3(back, -0.6, hw), new THREE.Vector3(back, R.GOAL_H, hw));
      // Поплавки ворот
      const flo = new THREE.MeshStandardMaterial({ color: 0xf07a1a, roughness: 0.5 });
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, hw * 2 + 0.6), flo); fl.position.set(back, 0.0, 0); g.add(fl);
      for (const zz of [-hw - 0.2, hw + 0.2]) { const f = new THREE.Mesh(new THREE.BoxGeometry(R.GOAL_DEPTH + 0.2, 0.12, 0.18), flo); f.position.set(gx + side * R.GOAL_DEPTH / 2, 0, zz); g.add(f); }
      // Сетка
      const netTex = canvasTex(128, 128, (c, w, h) => {
        c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 3;
        for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(i * 16, 0); c.lineTo(i * 16, h); c.stroke(); c.beginPath(); c.moveTo(0, i * 16); c.lineTo(w, i * 16); c.stroke(); }
      });
      netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
      const mkNet = (rx, ry) => { const t = netTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }); };
      const backNet = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 1.5), mkNet(15, 7));
      backNet.position.set(back, 0.15, 0); backNet.rotation.y = Math.PI / 2; g.add(backNet);
      const topNet = new THREE.Mesh(new THREE.PlaneGeometry(R.GOAL_DEPTH, hw * 2), mkNet(3, 15));
      topNet.rotation.x = -Math.PI / 2; topNet.position.set(gx + side * R.GOAL_DEPTH / 2, R.GOAL_H, 0); g.add(topNet);
      for (const zz of [-hw, hw]) {
        const sn = new THREE.Mesh(new THREE.PlaneGeometry(R.GOAL_DEPTH, 1.5), mkNet(3, 7));
        sn.position.set(gx + side * R.GOAL_DEPTH / 2, 0.15, zz); g.add(sn);
      }
      g.userData.backNet = backNet;
      s.add(g);
      return g;
    }

    buildArena() {
      const s = this.scene;
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x14212e, roughness: 0.9 });
      const back = new THREE.Mesh(new THREE.PlaneGeometry(70, 26), wallMat); back.position.set(0, 12, -27); s.add(back);
      for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(60, 26), wallMat); w.position.set(sx * 28, 12, 0); w.rotation.y = -sx * Math.PI / 2; s.add(w); }
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(70, 60), new THREE.MeshStandardMaterial({ color: 0x0c141d, roughness: 1 }));
      ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 18, 0); s.add(ceil);
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6e2 });
      for (let x = -21; x <= 21; x += 7) for (const z of [-9, 0, 9]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 2.4), lampMat); l.position.set(x, 17.8, z); s.add(l);
      }
      // Ступени трибун
      const stepMat = new THREE.MeshStandardMaterial({ color: 0x2a3644, roughness: 0.8 });
      this.standRows = [];
      for (let r = 0; r < 13; r++) {
        const z = -16.4 - r * 0.8, y = 0.3 + r * 0.55;
        const st = new THREE.Mesh(new THREE.BoxGeometry(46, 0.55, 0.8), stepMat); st.position.set(0, y + 0.27, z); s.add(st);
        this.standRows.push({ kind: 'side', z, y: y + 0.55 });
      }
      for (const sx of [-1, 1]) for (let r = 0; r < 8; r++) {
        const x = sx * (18.5 + r * 0.8), y = 0.3 + r * 0.55;
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 28), stepMat); st.position.set(x, y + 0.27, -1.5); s.add(st);
        this.standRows.push({ kind: 'end', x, y: y + 0.55, sx });
      }
      // Рекламные борта (нейтральные)
      const adTex = canvasTex(1024, 64, (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, '#0d2742'); grd.addColorStop(1, '#0b3a5a');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.font = '700 38px "Fira Sans Extra Condensed", Arial Narrow, sans-serif'; g.fillStyle = '#e8f3ff'; g.textBaseline = 'middle';
        const items = ['WATER POLO MOBILE', 'WORLD AQUATICS RULES 2025', '28 · 18 · 15', 'ВОДНОЕ ПОЛО'];
        let x = 20; let i = 0; while (x < w) { const t = items[i++ % items.length]; g.fillText(t, x, h / 2 + 2); x += g.measureText(t).width + 70; }
      });
      adTex.wrapS = THREE.RepeatWrapping; adTex.repeat.set(3, 1);
      const ad = new THREE.Mesh(new THREE.PlaneGeometry(44, 0.9), new THREE.MeshBasicMaterial({ map: adTex }));
      ad.position.set(0, 0.75, -15.8); s.add(ad);
    }

    buildCrowd() {
      const seats = [];
      for (const row of this.standRows) {
        if (row.kind === 'side') { for (let x = -22; x <= 22; x += 0.58) if (Math.random() < 0.72) seats.push([x + (Math.random() - 0.5) * 0.1, row.y, row.z]); }
        else { for (let z = -15; z <= 12; z += 0.58) if (Math.random() < 0.6) seats.push([row.x, row.y, z]); }
      }
      const n = seats.length;
      const bodyGeo = new THREE.BoxGeometry(0.42, 0.55, 0.32);
      const headGeo = new THREE.SphereGeometry(0.12, 8, 6);
      const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial(), n);
      const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial(), n);
      const palette = [0xd9d9d9, 0x2d4b8e, 0xc0392b, 0x1f1f1f, 0xe6b422, 0x2e7d32, 0x5d4037, 0x8e44ad, 0xffffff, 0x1565c0, 0x455a64];
      const skins = [0xf1c7a5, 0xd9a47c, 0xa8704a, 0x7a4b2e, 0xf6d7bd];
      const c = new THREE.Color(), m = new THREE.Matrix4();
      this.crowd = { bodies, heads, seats, phase: seats.map(() => Math.random() * 6.28), amp: seats.map(() => 0.5 + Math.random()) };
      seats.forEach((p, i) => {
        m.makeTranslation(p[0], p[1] + 0.28, p[2]); bodies.setMatrixAt(i, m);
        m.makeTranslation(p[0], p[1] + 0.68, p[2]); heads.setMatrixAt(i, m);
        bodies.setColorAt(i, c.set(palette[(Math.random() * palette.length) | 0]));
        heads.setColorAt(i, c.set(skins[(Math.random() * skins.length) | 0]));
      });
      this.scene.add(bodies, heads);
    }

    cheer(big) { this.cheerT = big ? 3.5 : 1.5; }

    updateCrowd(dt) {
      if (this.cheerT <= 0 && !this.crowdDirty) return;
      this.cheerT = Math.max(0, this.cheerT - dt);
      const k = Math.min(1, this.cheerT);
      const { bodies, heads, seats, phase, amp } = this.crowd;
      const m = new THREE.Matrix4();
      for (let i = 0; i < seats.length; i++) {
        const p = seats[i];
        const j = k * Math.abs(Math.sin(this.time * 9 * (0.7 + amp[i] * 0.3) + phase[i])) * 0.28 * amp[i];
        m.makeTranslation(p[0], p[1] + 0.28 + j, p[2]); bodies.setMatrixAt(i, m);
        m.makeTranslation(p[0], p[1] + 0.68 + j, p[2]); heads.setMatrixAt(i, m);
      }
      bodies.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
      this.crowdDirty = this.cheerT > 0;
    }

    buildBoards() {
      const s = this.scene;
      this.boardTex = canvasTex(1024, 400, () => {});
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.9), new THREE.MeshBasicMaterial({ map: this.boardTex, toneMapped: false }));
      scr.position.set(0, 12.2, -26.8); s.add(scr);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(10.4, 4.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x0a0f14 }));
      frame.position.set(0, 12.2, -27.0); s.add(frame);
      this.shotBoards = [];
      for (const sx of [-1, 1]) {
        const tex = canvasTex(256, 128, () => {});
        const box = new THREE.Group();
        const housing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        const face = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
        face.position.z = 0.16;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6), new THREE.MeshStandardMaterial({ color: 0x555555 }));
        pole.position.y = -1.0;
        box.add(housing, face, pole);
        box.position.set(sx * 15.6, 1.9, -6.5);
        box.rotation.y = sx > 0 ? -Math.PI / 2 + 0.35 : Math.PI / 2 - 0.35;
        s.add(box);
        this.shotBoards.push({ tex, val: null });
      }
    }

    updateBoards(info) {
      const key = [info.hc, info.ac, info.hs, info.as, info.per, info.clock, info.shot].join('|');
      if (key === this.boardKey) return;
      this.boardKey = key;
      const t = this.boardTex, g = t.userData.ctx, w = 1024, h = 400;
      g.fillStyle = '#05080b'; g.fillRect(0, 0, w, h);
      g.textBaseline = 'middle'; g.textAlign = 'center';
      g.font = '800 92px "Fira Sans Extra Condensed", Arial Narrow, sans-serif';
      g.fillStyle = '#ffffff'; g.fillText(info.hc, 170, 110); g.fillText(info.ac, 854, 110);
      g.font = '800 170px "Fira Sans Extra Condensed", Arial Narrow, sans-serif';
      g.fillStyle = '#ffd24a'; g.fillText(info.hs, 330, 150); g.fillText(info.as, 694, 150);
      g.fillStyle = '#ffffff'; g.font = '700 70px "Fira Sans Extra Condensed", Arial Narrow, sans-serif'; g.fillText(':', 512, 140);
      g.font = '700 84px "Fira Sans Extra Condensed", Arial Narrow, sans-serif'; g.fillStyle = '#9fd0ff';
      g.fillText(info.per + '   ' + info.clock, 512, 310);
      g.fillStyle = '#ff3b30'; g.font = '800 96px "Fira Sans Extra Condensed", Arial Narrow, sans-serif';
      g.fillText(info.shot, 170, 310); g.fillText(info.shot, 854, 310);
      t.needsUpdate = true;
      for (const b of this.shotBoards) {
        if (b.val === info.shot) continue;
        b.val = info.shot;
        const c = b.tex.userData.ctx;
        c.fillStyle = '#050505'; c.fillRect(0, 0, 256, 128);
        c.fillStyle = '#ff2a1f'; c.font = '800 110px "Fira Sans Extra Condensed", Arial Narrow, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(info.shot, 128, 68);
        b.tex.needsUpdate = true;
      }
    }

    // Судья: ноги, торс, руки с локтями, свисток. Вперёд — локальная +x
    makeOfficial(shirt, pants, skin) {
      const g = new THREE.Group();
      const mS = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.75 });
      const mP = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.7 });
      const mK = new THREE.MeshStandardMaterial({ color: skin || 0xe0b090, roughness: 0.6 });
      const mB = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 });
      const legs = {};
      for (const side of [-1, 1]) {
        const hip = new THREE.Group(); hip.position.set(0, 0.95, side * 0.1); g.add(hip);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.9, 10), mP); leg.position.y = -0.45; hip.add(leg);
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.11), mB); shoe.position.set(0.06, -0.9, 0); hip.add(shoe);
        legs[side] = hip;
      }
      const torso = new THREE.Mesh(new THREE.LatheGeometry([[0.14, 0.93], [0.165, 1.1], [0.19, 1.32], [0.205, 1.44], [0.14, 1.52], [0.06, 1.56]].map(p => new THREE.Vector2(p[0], p[1])), 16), mS);
      torso.scale.set(0.62, 1, 1); g.add(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 12), mK); head.position.y = 1.68; head.scale.set(1.05, 1.12, 0.95); g.add(head);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.108, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), mB); hair.position.set(-0.01, 1.7, 0); g.add(hair);
      const whistle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.02), mB); whistle.position.set(0.1, 1.61, 0); g.add(whistle);
      const arms = {};
      for (const side of [-1, 1]) {
        const sh = new THREE.Group(); sh.position.set(0, 1.46, side * 0.21); g.add(sh);
        const up = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.04, 0.3, 8), mS); up.position.y = -0.15; sh.add(up);
        const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
        const fo = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.03, 0.27, 8), mK); fo.position.y = -0.135; el.add(fo);
        const hand = new THREE.Group(); hand.position.y = -0.3; el.add(hand);
        const hm = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), mK); hm.scale.set(0.025, 0.06, 0.045); hand.add(hm);
        arms[side] = { sh, el, hand };
      }
      g.userData = { arms, legs };
      return g;
    }

    buildOfficials() {
      const s = this.scene;
      this.refs = [];
      for (const zs of [1, -1]) {
        const f = this.makeOfficial(0xf5f5f5, 0x1a2a44);
        f.position.set(zs * 3, 0.3, zs * (R.POOL_HALF_W + 1.0));
        f.rotation.y = zs > 0 ? Math.PI / 2 : -Math.PI / 2;
        s.add(f);
        this.refs.push({ fig: f, zs, x: zs * 3, walk: 0, g: null });
      }
      // Судьи у линии ворот с флажками возвращения удалённых
      this.judges = [];
      for (const sx of [-1, 1]) {
        const f = this.makeOfficial(0xf5f5f5, 0x1a2a44, 0xd6a47a);
        f.position.set(sx * (R.HALF_L + 0.25), 0.3, -(R.POOL_HALF_W + 1.1));
        f.rotation.y = -Math.PI / 2;
        s.add(f);
        const arm = f.userData.arms[-sx];
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
        pole.position.y = -0.1; pole.rotation.z = Math.PI / 2; arm.hand.add(pole);
        const clothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 });
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24), clothMat);
        cloth.position.set(0.22, 0.12, 0); pole.add(cloth);
        this.judges.push({ fig: f, sx, arm, cloth, clothMat, up: 0 });
      }
      // Судейский стол и скамейки
      const table = new THREE.Mesh(new THREE.BoxGeometry(5, 0.8, 0.9), new THREE.MeshStandardMaterial({ color: 0x0f3050 }));
      table.position.set(0, 0.7, -13.8); s.add(table);
      this.benches = [];
      for (const sx of [-1, 1]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(6, 0.45, 0.6), new THREE.MeshStandardMaterial({ color: 0x39424e }));
        b.position.set(sx * 7, 0.52, -13.9); s.add(b);
        this.benches.push({ x: sx * 7, figs: [] });
      }
    }

    setBench(side, capColor, count) {
      const b = this.benches[side];
      for (const f of b.figs) this.scene.remove(f);
      b.figs = [];
      for (let i = 0; i < count; i++) {
        const f = new THREE.Group();
        const robe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.3), new THREE.MeshStandardMaterial({ color: 0x1c2733 }));
        robe.position.y = 0.3;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: capColor }));
        head.position.y = 0.73;
        f.add(robe, head);
        f.position.set(b.x - 2.5 + i * (5 / Math.max(1, count - 1)), 0.75, -13.9);
        this.scene.add(f); b.figs.push(f);
      }
    }

    buildParticles() {
      const N = this.pN = 1000;
      const geo = new THREE.BufferGeometry();
      this.pPos = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3);
      this.pLife = new Float32Array(N); this.pSize = new Float32Array(N); this.pMax = new Float32Array(N);
      for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -50;
      geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
      geo.setAttribute('aLife', new THREE.BufferAttribute(this.pLife, 1));
      geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
      this.pts = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: PART_VS, fragmentShader: PART_FS, transparent: true, depthWrite: false }));
      this.pts.frustumCulled = false; this.pts.renderOrder = 2; this.pts.layers.set(1);
      this.scene.add(this.pts);
      this.pIdx = 0;
    }

    splash(x, y, z, n, power, dir) {
      power = power || 1;
      for (let k = 0; k < n; k++) {
        const i = this.pIdx; this.pIdx = (this.pIdx + 1) % this.pN;
        const a = Math.random() * Math.PI * 2, sp = (0.4 + Math.random()) * power;
        this.pPos[i * 3] = x + (Math.random() - 0.5) * 0.15;
        this.pPos[i * 3 + 1] = Math.max(0.02, y);
        this.pPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.15;
        this.pVel[i * 3] = Math.cos(a) * sp * 0.9 + (dir ? dir.x * power * 0.8 : 0);
        this.pVel[i * 3 + 1] = (1.2 + Math.random() * 2.2) * power;
        this.pVel[i * 3 + 2] = Math.sin(a) * sp * 0.9 + (dir ? dir.z * power * 0.8 : 0);
        this.pMax[i] = 0.5 + Math.random() * 0.6;
        this.pLife[i] = 1;
        this.pSize[i] = 0.05 + Math.random() * 0.08 * Math.min(2, power);
      }
    }

    updateParticles(dt) {
      for (let i = 0; i < this.pN; i++) {
        if (this.pLife[i] <= 0) continue;
        this.pVel[i * 3 + 1] -= 9.81 * dt;
        this.pPos[i * 3] += this.pVel[i * 3] * dt;
        this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
        this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
        this.pLife[i] -= dt / this.pMax[i];
        if (this.pPos[i * 3 + 1] < 0 && this.pVel[i * 3 + 1] < 0) this.pLife[i] = 0;
        if (this.pLife[i] <= 0) this.pPos[i * 3 + 1] = -50;
      }
      const g = this.pts.geometry;
      g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
    }

    setShadows(list) {
      for (let i = 0; i < 16; i++) {
        const s = list[i];
        if (s) this.shadowPts[i].set(s[0], s[1], s[2]); else this.shadowPts[i].set(0, 0, 0);
      }
    }

    // Рука официального лица по направлению в мире
    pointArm(fig, side, dir, bend) {
      const a = fig.userData.arms[side];
      const inv = this._q || (this._q = new THREE.Quaternion());
      inv.copy(fig.quaternion).invert();
      const v = (this._v || (this._v = new THREE.Vector3())).copy(dir).normalize().applyQuaternion(inv);
      a.sh.quaternion.slerp((this._q2 || (this._q2 = new THREE.Quaternion())).setFromUnitVectors(new THREE.Vector3(0, -1, 0), v), 0.25);
      a.el.rotation.z += ((bend || 0) - a.el.rotation.z) * 0.25;
    }

    // Жест судьи: free, excl, penalty, corner, goalthrow, goal, timeout, start
    refGesture(sig) {
      if (!this.refs) return;
      const x = sig.spot ? sig.spot.x : 0;
      let best = this.refs[0];
      for (const r of this.refs) if (Math.abs(r.x - x) < Math.abs(best.x - x)) best = r;
      best.g = Object.assign({ t: 0, dur: sig.type === 'excl' ? 2.4 : sig.type === 'penalty' || sig.type === 'timeout' ? 2.2 : 1.6 }, sig);
    }

    updateRefs(dt, ballX) {
      const V = new THREE.Vector3();
      for (const r of this.refs) {
        const f = r.fig;
        if (!r.g) {
          const target = THREE.MathUtils.clamp(ballX + r.zs * 2.5, -12, 12);
          const d = target - r.x;
          const step = Math.sign(d) * Math.min(Math.abs(d), 1.8 * dt);
          r.x += step; r.walk += Math.abs(step) * 5.5;
        }
        f.position.x = r.x;
        const L = f.userData.legs;
        L[1].rotation.z = Math.sin(r.walk) * 0.35; L[-1].rotation.z = -Math.sin(r.walk) * 0.35;
        const pos = f.position;
        const g = r.g;
        let right = V.set(0, -1, 0.12 * r.zs), left = new THREE.Vector3(0, -1, -0.12 * r.zs);
        right = right.clone(); let bendR = 0.15, bendL = 0.15;
        if (g) {
          g.t += dt;
          const to = (p) => new THREE.Vector3(p.x - pos.x, (p.y !== undefined ? p.y : 0) - 1.46 - pos.y, p.z - pos.z);
          switch (g.type) {
            case 'free': right = new THREE.Vector3(g.dir || 1, 0.12, 0); bendR = 0; break;
            case 'excl':
              right = g.t < 0.8 && g.player ? to({ x: g.player.x, y: 0.3, z: g.player.z }) : to({ x: g.zone.x, y: 0.2, z: g.zone.z });
              bendR = 0; break;
            case 'penalty': right = new THREE.Vector3(0, 1, 0.05); left = to({ x: g.spot.x, y: 0, z: 0 }); bendR = 0; bendL = 0; break;
            case 'corner': right = to({ x: g.spot.x, y: 0, z: g.spot.z }); bendR = 0; break;
            case 'goalthrow': right = to({ x: g.goalX, y: 0.3, z: 0 }); bendR = 0; break;
            case 'goal': right = to({ x: 0, y: 0.4, z: pos.z * 0.6 }); bendR = 0; break;
            case 'timeout': right = new THREE.Vector3(0, 1, 0); left = new THREE.Vector3(0.2, 0.05, r.zs > 0 ? -1 : 1); bendR = 0; bendL = 0; break;
            default: right = new THREE.Vector3(0.1, 1, 0); bendR = 0;
          }
          if (g.t > g.dur) r.g = null;
        }
        this.pointArm(f, r.zs > 0 ? 1 : -1, right, bendR);
        this.pointArm(f, r.zs > 0 ? -1 : 1, left, bendL);
      }
    }

    updateJudges(dt, flags) {
      if (!this.judges) return;
      for (const j of this.judges) {
        const fl = flags[j.sx > 0 ? 1 : 0];
        j.up += ((fl ? 1 : 0) - j.up) * Math.min(1, dt * 6);
        if (fl) j.clothMat.color.set(fl);
        const dir = new THREE.Vector3(0.15, -1 + 2 * j.up, 0.1 * j.up);
        this.pointArm(j.fig, -j.sx, dir, 0.3 * (1 - j.up));
        this.pointArm(j.fig, j.sx, new THREE.Vector3(0, -1, 0.1 * j.sx), 0.2);
        j.cloth.rotation.y = Math.sin(this.time * 7 + j.sx) * 0.25 * j.up;
      }
    }

    setCamMode(m) { this.camMode = m; }

    updateCamera(dt, focus, opts) {
      const f = this.camFocus;
      f.lerp(focus, 1 - Math.exp(-dt * 3.2));
      const cam = this.camera, pos = this.camPos, look = this.camLook;
      const narrow = cam.aspect < 1;
      let tp, tl;
      // Отладка: камера стоит, где поставили (WP.debug.cam)
      if (this.camOverride) { cam.position.copy(this.camOverride.pos); cam.lookAt(this.camOverride.look); return; }
      if (this.camMode === 'focus' && this.focusPlayer) {
        const p = this.focusPlayer, sd = this.focusSide || 1;
        tp = new THREE.Vector3(p.x - sd * 2.6, 1.7, p.z + 3.1);
        tl = new THREE.Vector3(p.x, 0.55, p.z);
        pos.lerp(tp, 1 - Math.exp(-dt * 3)); look.lerp(tl, 1 - Math.exp(-dt * 6));
        cam.position.copy(pos); cam.lookAt(look);
        return;
      }
      if (this.camMode === 'replay' && this.replayPos) {
        tp = this.replayPos.clone();
        tl = new THREE.Vector3(focus.x, Math.max(0, focus.y * 0.6), focus.z);
        pos.lerp(tp, 1 - Math.exp(-dt * 2.5)); look.lerp(tl, 1 - Math.exp(-dt * 6));
        cam.position.copy(pos); cam.lookAt(look);
        return;
      } else if (this.camMode === 'orbit') {
        const a = this.time * 0.06;
        tp = new THREE.Vector3(Math.sin(a) * 25, 9 + Math.sin(a * 0.7) * 2, Math.cos(a) * 21);
        tl = new THREE.Vector3(f.x * 0.4, -0.5, f.z * 0.3);
      } else if (this.camMode === 'high') {
        tp = new THREE.Vector3(f.x * 0.25, narrow ? 40 : 29, narrow ? 3 : 9);
        tl = new THREE.Vector3(f.x * 0.25, 0, 0);
      } else if (this.camMode === 'end') {
        const dir = (opts && opts.dir) || 1;
        tp = new THREE.Vector3(-dir * 19.5, 7.5, f.z * 0.25);
        tl = new THREE.Vector3(f.x + dir * 3, -0.5, f.z * 0.4);
      } else if (this.camMode === 'close') {
        tp = new THREE.Vector3(f.x * 0.9, 5.2, f.z + 9.5);
        tl = new THREE.Vector3(f.x, 0.2, f.z);
      } else if (narrow) {
        // Портретный экран: смотрим вдоль бассейна, длинная ось идёт вверх по экрану
        tp = new THREE.Vector3(f.x * 0.55 - 17.5, 12.5, f.z * 0.25);
        tl = new THREE.Vector3(f.x * 0.85 + 2.5, -0.8, f.z * 0.3);
      } else {
        tp = new THREE.Vector3(f.x * 0.8, 10.5, 20.5);
        tl = new THREE.Vector3(f.x * 0.9, -0.6, f.z * 0.35 - 0.4);
      }
      const k = 1 - Math.exp(-dt * (this.camMode === 'orbit' ? 1.2 : 4));
      pos.lerp(tp, k); look.lerp(tl, k);
      cam.position.copy(pos); cam.lookAt(look);
    }

    update(dt) {
      this.time += dt;
      this.waterMat.uniforms.uTime.value = this.time;
      this.waterMat.uniforms.uCam.value.copy(this.camera.position);
      for (const m of this.floorMats) m.uniforms.uTime.value = this.time;
      this.updateParticles(dt);
      this.updateCrowd(dt);
      this.flushFoam(dt);
    }

    // Качество: разрешение рендера и частота обновления трибун (на слабых телефонах)
    setQuality(pr, low) {
      this.renderer.setPixelRatio(pr);
      this.lowGfx = !!low;
      this.resize();
    }

    // Второй проход (вода, брызги, кольца управления) рисуется поверх копии первого
    overlay(obj) { obj.traverse(o => o.layers.set(1)); return obj; }

    render() {
      const r = this.renderer, cam = this.camera;
      const sz = this._sz || (this._sz = new THREE.Vector2());
      r.getDrawingBufferSize(sz);
      if (!this.fbTex || this.fbTex.image.width !== sz.x || this.fbTex.image.height !== sz.y) {
        if (this.fbTex) this.fbTex.dispose();
        this.fbTex = new THREE.FramebufferTexture(sz.x, sz.y);
        this.fbTex.minFilter = this.fbTex.magFilter = THREE.LinearFilter;
        this.waterMat.uniforms.uFB.value = this.fbTex;
        this.waterMat.uniforms.uRes.value.set(sz.x, sz.y);
      }
      r.autoClear = true;
      cam.layers.set(0);
      r.render(this.scene, cam);
      r.copyFramebufferToTexture(this._zero || (this._zero = new THREE.Vector2()), this.fbTex);
      r.autoClear = false;
      const bg = this.scene.background;
      this.scene.background = null; // иначе цветной фон принудительно очистит кадр
      cam.layers.set(1);
      r.render(this.scene, cam);
      cam.layers.set(0);
      this.scene.background = bg;
      r.autoClear = true;
    }
  }

  WP.World = World;
})();
