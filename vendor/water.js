/* Water — Anime Style
   Port of cortiz2894/stylized-components /water (MIT, Christian Ortiz).
   WebGL2 only. Missing images become a 1x1 black texture. */
(function () {
  const canvas = document.getElementById("canvas");
  if (!canvas) return;
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });
  if (!gl) return;

  const WATER_Y = -0.1;
  const WAVE_RES = 256;
  const TEXEL = 1 / WAVE_RES;
  const PLANE = 300;

  const DEG = Math.PI / 180;
  let camAz = -135 * DEG;
  let camPol = 58 * DEG;
  let camRadius = 28;
  const camTarget = [0, 0, 0];

  /* Upstream SceneCamera: eye = target + r (sinφ sinθ, cosφ, sinφ cosθ). */
  function camEye() {
    const sp = Math.sin(camPol);
    const cp = Math.cos(camPol);
    const st = Math.sin(camAz);
    const ct = Math.cos(camAz);
    return [
      camTarget[0] + camRadius * sp * st,
      camTarget[1] + camRadius * cp,
      camTarget[2] + camRadius * sp * ct,
    ];
  }

  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan((fov * DEG) / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  }

  function ortho(left, right, bottom, top, near, far) {
    const w = 1 / (right - left);
    const h = 1 / (top - bottom);
    const p = 1 / (far - near);
    return new Float32Array([
      2 * w, 0, 0, 0,
      0, 2 * h, 0, 0,
      0, 0, -2 * p, 0,
      -(right + left) * w, -(top + bottom) * h, -(far + near) * p, 1,
    ]);
  }

  function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function viewMatrix(eye, target, up) {
    const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    let x = cross(up, z);
    const xl = Math.hypot(x[0], x[1], x[2]);
    if (xl < 1e-6) x = [1, 0, 0];
    else x = [x[0] / xl, x[1] / xl, x[2] / xl];
    const y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
    ]);
  }

  /* Three.js Euler XYZ, column-major 3x3. */
  function rotXYZ(x, y, z) {
    const a = Math.cos(x), b = Math.sin(x);
    const c = Math.cos(y), d = Math.sin(y);
    const e = Math.cos(z), f = Math.sin(z);
    const ae = a * e, af = a * f, be = b * e, bf = b * f;
    return new Float32Array([
      c * e, af + be * d, bf - ae * d,
      -c * f, ae - bf * d, be + af * d,
      d, -b * c, a * c,
    ]);
  }

  function modelFrom(rot, s, p) {
    const m = new Float32Array(16);
    m[0] = rot[0] * s; m[1] = rot[1] * s; m[2] = rot[2] * s;
    m[4] = rot[3] * s; m[5] = rot[4] * s; m[6] = rot[5] * s;
    m[8] = rot[6] * s; m[9] = rot[7] * s; m[10] = rot[8] * s;
    m[12] = p[0]; m[13] = p[1]; m[14] = p[2]; m[15] = 1;
    return m;
  }

  const IDENT = rotXYZ(0, 0, 0);

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function program(vs, fs) {
    const p = gl.createProgram();
    const a = compile(gl.VERTEX_SHADER, vs);
    const b = compile(gl.FRAGMENT_SHADER, fs);
    if (!a || !b) return null;
    gl.attachShader(p, a);
    gl.attachShader(p, b);
    gl.bindAttribLocation(p, 0, "aPos");
    gl.bindAttribLocation(p, 1, "aNrm");
    gl.bindAttribLocation(p, 2, "aUv");
    gl.bindAttribLocation(p, 3, "aLifetime");
    gl.bindAttribLocation(p, 4, "aMaxLifetime");
    gl.bindAttribLocation(p, 5, "aSize");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p));
      return null;
    }
    gl.deleteShader(a);
    gl.deleteShader(b);
    return p;
  }

  function locs(p, names) {
    const o = {};
    for (const n of names) o[n] = gl.getUniformLocation(p, n);
    return o;
  }

  function buf(target, data, usage) {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage || gl.STATIC_DRAW);
    return b;
  }

  function meshVAO(pos, nrm, uv, idx) {
    let indexType = gl.UNSIGNED_SHORT;
    let indexArr = idx;
    let max = 0;
    for (let i = 0; i < idx.length; i++) if (idx[i] > max) max = idx[i];
    if (max > 65535) {
      indexType = gl.UNSIGNED_INT;
      indexArr = idx instanceof Uint32Array ? idx : Uint32Array.from(idx);
    } else if (!(idx instanceof Uint16Array)) {
      indexArr = new Uint16Array(idx);
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf(gl.ARRAY_BUFFER, pos));
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    if (nrm) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf(gl.ARRAY_BUFFER, nrm));
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    }
    if (uv) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf(gl.ARRAY_BUFFER, uv));
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf(gl.ELEMENT_ARRAY_BUFFER, indexArr));
    gl.bindVertexArray(null);
    return { vao: vao, count: indexArr.length, indexType: indexType };
  }

  function planeMesh() {
    const s = PLANE;
    const pos = new Float32Array([
      -s, 0, -s,
      s, 0, -s,
      s, 0, s,
      -s, 0, s,
    ]);
    const nrm = new Float32Array([
      0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]);
    const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    /* +Y normal so FrontSide is visible from above. */
    const idx = new Uint16Array([0, 3, 2, 0, 2, 1]);
    return meshVAO(pos, nrm, uv, idx);
  }

  function solidTex(r, g, b, a) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([r, g, b, a]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  const blackTex = solidTex(0, 0, 0, 255);

  function makeColorRT(w, h, half) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const internal = half ? gl.RGBA16F : gl.RGBA8;
    const type = half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      return null;
    }
    return { tex: tex, fb: fb, w: w, h: h };
  }

  let halfOK = false;
  if (gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float")) {
    halfOK = !!makeColorRT(4, 4, true);
  }
  gl.getExtension("OES_texture_float_linear");

  function colorRT(w, h) {
    return makeColorRT(w, h, halfOK) || makeColorRT(w, h, false);
  }

  const P_SKY_VS = "attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}";
  const P_SKY_FS = [
    "precision highp float;",
    "uniform float uH;",
    "void main(){",
    "  float h=gl_FragCoord.y/uH;",
    "  vec3 top=vec3(0.02,0.05,0.12);",
    "  vec3 hor=vec3(0.55,0.78,0.92);",
    "  vec3 col=mix(hor,top,smoothstep(0.42,1.0,h));",
    "  gl_FragColor=vec4(col,1.0);",
    "}",
  ].join("\n");

  const LIT_VS = [
    "attribute vec3 aPos;attribute vec3 aNrm;attribute vec2 aUv;",
    "uniform mat4 uMVP;uniform mat4 uModel;uniform mat3 uNmat;",
    "varying vec3 vN;varying vec2 vUv;varying vec3 vW;",
    "void main(){",
    "  vec4 w=uModel*vec4(aPos,1.0);",
    "  vW=w.xyz;vN=uNmat*aNrm;vUv=aUv;",
    "  gl_Position=uMVP*vec4(aPos,1.0);",
    "}",
  ].join("\n");

  const LIT_FS = [
    "precision highp float;",
    "uniform sampler2D uMap;",
    "uniform float uCut;",
    "varying vec3 vN;varying vec2 vUv;",
    "void main(){",
    "  vec4 t=texture2D(uMap,vUv);",
    "  if(t.a<uCut) discard;",
    "  vec3 L=normalize(vec3(5.0,8.0,3.0));",
    "  float nd=abs(dot(normalize(vN),L));",
    "  vec3 col=t.rgb*(0.40+1.35*nd)*vec3(1.0,0.95,0.88);",
    "  gl_FragColor=vec4(col,1.0);",
    "}",
  ].join("\n");

  const STAR_FS = [
    "precision highp float;",
    "varying vec3 vN;varying vec3 vW;",
    "void main(){",
    "  vec3 N=normalize(vN);",
    "  vec3 V=normalize(vec3(-10.2,9.0,-10.2)-vW);",
    "  float f=pow(1.0-max(dot(N,V),0.0),2.0);",
    "  vec3 col=vec3(1.0,0.98,0.95)*(1.15+f*1.4);",
    "  gl_FragColor=vec4(col,1.0);",
    "}",
  ].join("\n");

  const GLASS_VS = [
    "attribute vec3 aPos;attribute vec3 aNrm;",
    "uniform mat4 uMVP;uniform mat4 uModel;uniform mat3 uNmat;",
    "varying vec3 vWorld;varying vec3 vN;",
    "void main(){",
    "  vec4 w=uModel*vec4(aPos,1.0);",
    "  vWorld=w.xyz;vN=normalize(uNmat*aNrm);",
    "  gl_Position=uMVP*vec4(aPos,1.0);",
    "}",
  ].join("\n");

  const GLASS_FS = [
    "precision highp float;",
    "uniform float uTime;uniform vec3 uCam;",
    "uniform float uWaterY;uniform float uWaterLineSoftness;uniform float uWaterLineWave;",
    "uniform vec3 uWaterLineColor;uniform vec3 uGlassColor;uniform float uGlassOpacity;",
    "uniform vec3 uUnderwaterColor;uniform float uUnderwaterOpacity;",
    "uniform float uFresnelPower;uniform float uFresnelStrength;uniform vec3 uFresnelColor;",
    "uniform float uRoughness;",
    "varying vec3 vWorld;varying vec3 vN;",
    "vec3 hash3(vec3 p){",
    "  p=fract(p*vec3(443.8975,397.2973,491.1871));",
    "  p+=dot(p,p.yzx+19.19);",
    "  return fract((p.xxy+p.yzz)*p.zyx)*2.0-1.0;",
    "}",
    "float vnoise(vec3 p){",
    "  vec3 i=floor(p);vec3 f=fract(p);vec3 u=f*f*(3.0-2.0*f);",
    "  return mix(mix(mix(dot(hash3(i),f),dot(hash3(i+vec3(1.0,0.0,0.0)),f-vec3(1.0,0.0,0.0)),u.x),",
    "                 mix(dot(hash3(i+vec3(0.0,1.0,0.0)),f-vec3(0.0,1.0,0.0)),dot(hash3(i+vec3(1.0,1.0,0.0)),f-vec3(1.0,1.0,0.0)),u.x),u.y),",
    "             mix(mix(dot(hash3(i+vec3(0.0,0.0,1.0)),f-vec3(0.0,0.0,1.0)),dot(hash3(i+vec3(1.0,0.0,1.0)),f-vec3(1.0,0.0,1.0)),u.x),",
    "                 mix(dot(hash3(i+vec3(0.0,1.0,1.0)),f-vec3(0.0,1.0,1.0)),dot(hash3(i+vec3(1.0,1.0,1.0)),f-vec3(1.0,1.0,1.0)),u.x),u.y),u.z);",
    "}",
    "void main(){",
    "  vec3 viewDir=normalize(uCam-vWorld);",
    "  vec3 N=normalize(vN);",
    "  if(uRoughness>0.001){",
    "    vec3 np=vWorld*6.0;",
    "    vec3 d=vec3(vnoise(np),vnoise(np+vec3(1.7,9.2,3.8)),vnoise(np+vec3(8.3,2.8,5.1)));",
    "    N=normalize(N+d*uRoughness*0.8);",
    "  }",
    "  float NdotV=max(dot(N,viewDir),0.0);",
    "  float fresnel=clamp(pow(1.0-NdotV,uFresnelPower)*uFresnelStrength,0.0,1.0);",
    "  float wave=sin(vWorld.x*4.0+uTime*2.5)*uWaterLineWave+cos(vWorld.z*3.5+uTime*1.8)*uWaterLineWave*0.6;",
    "  float waterY=uWaterY+wave;",
    "  float sub=1.0-smoothstep(waterY-uWaterLineSoftness,waterY+uWaterLineSoftness,vWorld.y);",
    "  float wlDist=abs(vWorld.y-waterY)/max(uWaterLineSoftness*2.5,0.001);",
    "  float wlGlow=exp(-wlDist*wlDist)*0.7;",
    "  vec3 aboveColor=mix(uGlassColor,uFresnelColor,fresnel*0.6);",
    "  float aboveAlpha=mix(uGlassOpacity,min(uGlassOpacity+0.35,1.0),fresnel);",
    "  vec3 belowColor=mix(uUnderwaterColor,uGlassColor,0.25+fresnel*0.2);",
    "  vec3 color=mix(aboveColor,belowColor,sub);",
    "  float alpha=mix(aboveAlpha,uUnderwaterOpacity,sub);",
    "  color=mix(color,uWaterLineColor,wlGlow*0.5);",
    "  alpha=max(alpha,wlGlow*0.6);",
    "  gl_FragColor=vec4(color,alpha);",
    "}",
  ].join("\n");

  const FLOOR_VS = [
    "attribute vec3 aPos;",
    "uniform mat4 uMVP;uniform mat4 uModel;",
    "varying vec2 vWorldPos;",
    "void main(){",
    "  vec4 w=uModel*vec4(aPos,1.0);",
    "  vWorldPos=w.xz;",
    "  gl_Position=uMVP*vec4(aPos,1.0);",
    "}",
  ].join("\n");

  const SEABED_FS = [
    "precision highp float;",
    "uniform float uTime;uniform float uScale;uniform float uCellSpeed;",
    "uniform float uFlowX;uniform float uFlowZ;uniform float uEdgeThreshold;uniform float uEdgeSoftness;",
    "uniform vec3 uDeepColor;uniform vec3 uHighlight;",
    "uniform float uFadeDistance;uniform float uFadeStrength;uniform vec2 uCamXZ;",
    "varying vec2 vWorldPos;",
    "vec2 hash2(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}",
    "float smin(float a,float b,float k){float h=max(k-abs(a-b),0.0)/k;return min(a,b)-h*h*h*k/6.0;}",
    "vec2 cellPt(vec2 seed){return 0.5+0.5*sin(uTime*uCellSpeed+6.2831*seed);}",
    "float voronoiF1(vec2 p){vec2 i=floor(p),f=fract(p);float md=8.0;",
    "  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){vec2 n=vec2(float(x),float(y));vec2 pt=cellPt(hash2(i+n));md=min(md,length(n+pt-f));}",
    "  return md;}",
    "float voronoiSF1(vec2 p){vec2 i=floor(p),f=fract(p);float res=8.0;",
    "  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){vec2 n=vec2(float(x),float(y));vec2 pt=cellPt(hash2(i+n));res=smin(res,length(n+pt-f),0.4);}",
    "  return res;}",
    "void main(){",
    "  vec2 uv=vWorldPos*uScale+vec2(uFlowX,uFlowZ)*uTime;",
    "  float edge=voronoiF1(uv)-voronoiSF1(uv);",
    "  float t=smoothstep(uEdgeThreshold-uEdgeSoftness,uEdgeThreshold+uEdgeSoftness,edge);",
    "  vec3 color=mix(uDeepColor,uHighlight,t);",
    "  float dist=length(vWorldPos-uCamXZ);",
    "  float fade=1.0-pow(clamp(dist/uFadeDistance,0.0,1.0),uFadeStrength);",
    "  gl_FragColor=vec4(color,fade);",
    "}",
  ].join("\n");

  const WATER_FS = [
    "precision highp float;",
    "uniform float uTime;uniform float uScale;uniform float uSmoothness;",
    "uniform float uEdgeThreshold;uniform float uEdgeSoftness;",
    "uniform float uFlowX;uniform float uFlowZ;uniform float uCellSpeed;",
    "uniform float uNoiseScale;uniform float uNoiseFlowSpeed;uniform float uDistortAmount;",
    "uniform vec3 uDeepColor;uniform vec3 uMidColor;uniform float uMidPos;uniform vec3 uHighlight;",
    "uniform float uOpacity;uniform float uDeepOpacity;uniform float uFadeDistance;uniform float uFadeStrength;",
    "uniform vec2 uCamXZ;",
    "uniform vec2 uRippleCenters[8];uniform float uRippleTimes[8];uniform int uRippleCount;",
    "uniform float uRippleSpeed;uniform float uRippleWidth;uniform float uRippleStrength;",
    "uniform float uRippleDecay;uniform int uRippleRings;uniform float uRippleSpacing;",
    "varying vec2 vWorldPos;",
    "vec2 hash2(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}",
    "float smin(float a,float b,float k){float h=max(k-abs(a-b),0.0)/k;return min(a,b)-h*h*h*k/6.0;}",
    "vec2 cellPt(vec2 seed){return 0.5+0.5*sin(uTime*uCellSpeed+6.2831*seed);}",
    "float voronoiF1(vec2 p){vec2 i=floor(p),f=fract(p);float md=8.0;",
    "  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){vec2 n=vec2(float(x),float(y));vec2 pt=cellPt(hash2(i+n));md=min(md,length(n+pt-f));}return md;}",
    "float voronoiSF1(vec2 p){vec2 i=floor(p),f=fract(p);float res=8.0;",
    "  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){vec2 n=vec2(float(x),float(y));vec2 pt=cellPt(hash2(i+n));res=smin(res,length(n+pt-f),uSmoothness);}return res;}",
    "float nHash(vec2 p){p=fract(p*vec2(127.1,311.7));p+=dot(p,p+45.32);return fract(p.x*p.y);}",
    "float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);",
    "  return mix(mix(nHash(i),nHash(i+vec2(1.0,0.0)),f.x),mix(nHash(i+vec2(0.0,1.0)),nHash(i+vec2(1.0,1.0)),f.x),f.y);}",
    "float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<2;i++){v+=a*vnoise(p);p*=2.0;a*=0.5;}return v;}",
    "void main(){",
    "  vec2 noiseUV=vWorldPos*uNoiseScale+vec2(uTime*uNoiseFlowSpeed,0.0);",
    "  float noiseFac=fbm(noiseUV);",
    "  vec2 distort=vec2(noiseFac-0.5)*uDistortAmount;",
    "  vec2 uv=vWorldPos*uScale+vec2(uFlowX,uFlowZ)*uTime+distort;",
    "  float edge=voronoiF1(uv)-voronoiSF1(uv);",
    "  float t=smoothstep(uEdgeThreshold-uEdgeSoftness,uEdgeThreshold+uEdgeSoftness,edge);",
    "  float safeMP=max(uMidPos,0.0001);",
    "  float seg0=clamp(t/safeMP,0.0,1.0);",
    "  float seg1=clamp((t-safeMP)/max(1.0-safeMP,0.0001),0.0,1.0);",
    "  float inSeg1=step(safeMP,t);",
    "  vec3 color=mix(mix(uDeepColor,uMidColor,seg0),mix(uMidColor,uHighlight,seg1),inSeg1);",
    "  float rippleAcc=0.0;",
    "  for(int i=0;i<8;i++){",
    "    if(i>=uRippleCount) break;",
    "    float isOn=step(float(i),float(uRippleCount)-0.5);",
    "    float elapsed=max(uTime-uRippleTimes[i],0.0);",
    "    float d=length(vWorldPos-uRippleCenters[i]);",
    "    for(int r=0;r<4;r++){",
    "      if(r>=uRippleRings) break;",
    "      float rIsOn=step(float(r),float(uRippleRings)-0.5);",
    "      float re=max(elapsed-float(r)*uRippleSpacing,0.0);",
    "      float ringR=re*uRippleSpeed;",
    "      float ring=1.0-smoothstep(0.0,uRippleWidth,abs(d-ringR));",
    "      rippleAcc+=ring*exp(-re*uRippleDecay)*isOn*rIsOn;",
    "    }",
    "  }",
    "  float ripple=clamp(rippleAcc*uRippleStrength,0.0,1.0);",
    "  color=mix(color,uHighlight,ripple);",
    "  float dist=length(vWorldPos-uCamXZ);",
    "  float fade=1.0-pow(clamp(dist/uFadeDistance,0.0,1.0),uFadeStrength);",
    "  float alpha=mix(uDeepOpacity,1.0,max(t,ripple))*uOpacity*fade;",
    "  gl_FragColor=vec4(color,alpha);",
    "}",
  ].join("\n");

  const INJ_VS = [
    "attribute vec3 aPos;",
    "uniform mat4 uMVP;uniform mat4 uModel;",
    "varying float vWorldY;",
    "void main(){vec4 w=uModel*vec4(aPos,1.0);vWorldY=w.y;gl_Position=uMVP*vec4(aPos,1.0);}",
  ].join("\n");
  const INJ_FS = [
    "precision highp float;",
    "uniform float uWaterY;uniform float uBandWidth;varying float vWorldY;",
    "void main(){float d=abs(vWorldY-uWaterY);if(d>uBandWidth) discard;float s=1.0-smoothstep(0.0,uBandWidth,d);gl_FragColor=vec4(s,0.0,0.0,1.0);}",
  ].join("\n");

  const WAVE_VS = "attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}";
  const WAVE_FS = [
    "precision highp float;",
    "uniform sampler2D uWaveTex;uniform sampler2D uInjection;",
    "uniform float uTexelSize;uniform float uResolution;uniform float uSpeed;uniform float uDamping;",
    "uniform float uInjectStr;uniform float uInjectAmp;uniform float uBorderWidth;",
    "void main(){",
    "  vec2 uv=gl_FragCoord.xy/uResolution;",
    "  float cur=texture2D(uWaveTex,uv).r;float prev=texture2D(uWaveTex,uv).g;",
    "  float left=texture2D(uWaveTex,uv+vec2(-uTexelSize,0.0)).r;",
    "  float right=texture2D(uWaveTex,uv+vec2(uTexelSize,0.0)).r;",
    "  float up=texture2D(uWaveTex,uv+vec2(0.0,uTexelSize)).r;",
    "  float down=texture2D(uWaveTex,uv+vec2(0.0,-uTexelSize)).r;",
    "  float next=(2.0*cur-prev+uSpeed*(left+right+up+down-4.0*cur))*uDamping;",
    "  float edge=min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y));",
    "  next*=smoothstep(0.0,uBorderWidth,edge);",
    "  float inject=texture2D(uInjection,uv).r;",
    "  next=mix(next,uInjectAmp,inject*uInjectStr);",
    "  next=clamp(next,-1.0,1.0);",
    "  gl_FragColor=vec4(next,cur,0.0,1.0);",
    "}",
  ].join("\n");

  const DISP_FS = [
    "precision highp float;",
    "uniform sampler2D uWaveTex;uniform vec2 uCenter;uniform float uWaveSize;uniform float uTexelSize;",
    "uniform float uGradScale;uniform float uRingThreshold;uniform float uEdgeSharpness;",
    "uniform vec3 uColor;uniform float uOpacity;",
    "varying vec2 vWorldPos;",
    "void main(){",
    "  float u=(vWorldPos.x-uCenter.x)/(uWaveSize*2.0)+0.5;",
    "  float v=-(vWorldPos.y-uCenter.y)/(uWaveSize*2.0)+0.5;",
    "  vec2 uv=vec2(u,v);",
    "  if(any(lessThan(uv,vec2(0.01)))||any(greaterThan(uv,vec2(0.99)))) discard;",
    "  float dx=texture2D(uWaveTex,uv+vec2(uTexelSize,0.0)).r-texture2D(uWaveTex,uv-vec2(uTexelSize,0.0)).r;",
    "  float dy=texture2D(uWaveTex,uv+vec2(0.0,uTexelSize)).r-texture2D(uWaveTex,uv-vec2(0.0,uTexelSize)).r;",
    "  float grad=length(vec2(dx,dy))*uGradScale;",
    "  float halfEdge=mix(0.35,0.01,uEdgeSharpness);",
    "  float ring=smoothstep(uRingThreshold-halfEdge,uRingThreshold+halfEdge,grad);",
    "  if(ring<0.01) discard;",
    "  gl_FragColor=vec4(uColor,ring*uOpacity);",
    "}",
  ].join("\n");

  const DEPTH_FS = "precision highp float;void main(){gl_FragColor=vec4(1.0);}";
  const HIT_FS = [
    "precision highp float;",
    "uniform sampler2D uDepthTex;uniform vec2 uResolution;uniform float uNear;uniform float uFar;",
    "uniform float uLineWidth;uniform float uGlowWidth;uniform vec3 uLineColor;uniform float uLineOpacity;",
    "uniform vec3 uGlowColor;uniform float uGlowOpacity;",
    "float linearDepth(float raw){float z=raw*2.0-1.0;return (2.0*uNear*uFar)/(uFar+uNear-z*(uFar-uNear));}",
    "void main(){",
    "  vec2 screenUV=gl_FragCoord.xy/uResolution;",
    "  float rawScene=texture2D(uDepthTex,screenUV).r;",
    "  if(rawScene>0.9999) discard;",
    "  float diff=abs(linearDepth(rawScene)-linearDepth(gl_FragCoord.z));",
    "  float line=1.0-smoothstep(0.0,uLineWidth,diff);",
    "  float glow=exp(-diff/max(uGlowWidth,0.001));",
    "  float lineContrib=line*uLineOpacity;",
    "  float glowContrib=glow*uGlowOpacity;",
    "  float totalAlpha=max(lineContrib,glowContrib);",
    "  if(totalAlpha<0.005) discard;",
    "  gl_FragColor=vec4(mix(uGlowColor,uLineColor,line),totalAlpha);",
    "}",
  ].join("\n");

  const SPARK_VS = [
    "attribute vec3 aPos;attribute float aLifetime;attribute float aMaxLifetime;attribute float aSize;",
    "uniform mat4 uView;uniform mat4 uProj;",
    "varying float vAlpha;",
    "void main(){",
    "  float t=clamp(aLifetime/aMaxLifetime,0.0,1.0);",
    "  vAlpha=sin(t*3.14159265);",
    "  vec4 mv=uView*vec4(aPos,1.0);",
    "  gl_PointSize=aSize*(300.0/max(-mv.z,4.0));",
    "  gl_Position=uProj*mv;",
    "}",
  ].join("\n");
  const SPARK_FS = [
    "precision highp float;",
    "uniform vec3 uColor;uniform float uIntensity;uniform float uArmSharpness;uniform float uArmFalloff;uniform float uGlowRadius;",
    "varying float vAlpha;",
    "void main(){",
    "  vec2 uv=gl_PointCoord*2.0-1.0;",
    "  float hArm=exp(-abs(uv.y)*uArmSharpness)*exp(-abs(uv.x)*uArmFalloff);",
    "  float vArm=exp(-abs(uv.x)*uArmSharpness)*exp(-abs(uv.y)*uArmFalloff);",
    "  float glow=exp(-length(uv)*uGlowRadius);",
    "  float star=max(max(hArm,vArm),glow);",
    "  if(star<0.005) discard;",
    "  gl_FragColor=vec4(uColor*uIntensity,star*vAlpha);",
    "}",
  ].join("\n");

  const prog = {
    sky: program(P_SKY_VS, P_SKY_FS),
    lit: program(LIT_VS, LIT_FS),
    star: program(LIT_VS, STAR_FS),
    glass: program(GLASS_VS, GLASS_FS),
    floor: program(FLOOR_VS, SEABED_FS),
    water: program(FLOOR_VS, WATER_FS),
    inj: program(INJ_VS, INJ_FS),
    wave: program(WAVE_VS, WAVE_FS),
    disp: program(FLOOR_VS, DISP_FS),
    depth: program(INJ_VS, DEPTH_FS),
    hit: program(FLOOR_VS, HIT_FS),
    spark: program(SPARK_VS, SPARK_FS),
  };
  if (!prog.water || !prog.floor || !prog.wave) return;

  const U = {};
  U.sky = locs(prog.sky, ["uH"]);
  U.lit = locs(prog.lit, ["uMVP", "uModel", "uNmat", "uMap", "uCut"]);
  U.star = locs(prog.star, ["uMVP", "uModel", "uNmat"]);
  U.glass = locs(prog.glass, [
    "uMVP", "uModel", "uNmat", "uTime", "uCam", "uWaterY", "uWaterLineSoftness", "uWaterLineWave",
    "uWaterLineColor", "uGlassColor", "uGlassOpacity", "uUnderwaterColor", "uUnderwaterOpacity",
    "uFresnelPower", "uFresnelStrength", "uFresnelColor", "uRoughness",
  ]);
  U.floor = locs(prog.floor, [
    "uMVP", "uModel", "uTime", "uScale", "uCellSpeed", "uFlowX", "uFlowZ", "uEdgeThreshold",
    "uEdgeSoftness", "uDeepColor", "uHighlight", "uFadeDistance", "uFadeStrength", "uCamXZ",
  ]);
  U.water = locs(prog.water, [
    "uMVP", "uModel", "uTime", "uScale", "uSmoothness", "uEdgeThreshold", "uEdgeSoftness",
    "uFlowX", "uFlowZ", "uCellSpeed", "uNoiseScale", "uNoiseFlowSpeed", "uDistortAmount",
    "uDeepColor", "uMidColor", "uMidPos", "uHighlight", "uOpacity", "uDeepOpacity",
    "uFadeDistance", "uFadeStrength", "uCamXZ", "uRippleCenters", "uRippleTimes", "uRippleCount",
    "uRippleSpeed", "uRippleWidth", "uRippleStrength", "uRippleDecay", "uRippleRings", "uRippleSpacing",
  ]);
  U.inj = locs(prog.inj, ["uMVP", "uModel", "uWaterY", "uBandWidth"]);
  U.wave = locs(prog.wave, [
    "uWaveTex", "uInjection", "uTexelSize", "uResolution", "uSpeed", "uDamping",
    "uInjectStr", "uInjectAmp", "uBorderWidth",
  ]);
  U.disp = locs(prog.disp, [
    "uMVP", "uModel", "uWaveTex", "uCenter", "uWaveSize", "uTexelSize", "uGradScale",
    "uRingThreshold", "uEdgeSharpness", "uColor", "uOpacity",
  ]);
  U.depth = locs(prog.depth, ["uMVP", "uModel"]);
  U.hit = locs(prog.hit, [
    "uMVP", "uModel", "uDepthTex", "uResolution", "uNear", "uFar", "uLineWidth", "uGlowWidth",
    "uLineColor", "uLineOpacity", "uGlowColor", "uGlowOpacity",
  ]);
  U.spark = locs(prog.spark, [
    "uView", "uProj", "uColor", "uIntensity", "uArmSharpness", "uArmFalloff", "uGlowRadius",
  ]);


  const quad = planeMesh();
  const fsPos = new Float32Array([-1, -1, 3, -1, -1, 3]);
  const fsVAO = gl.createVertexArray();
  gl.bindVertexArray(fsVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf(gl.ARRAY_BUFFER, fsPos));
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const injRT = colorRT(WAVE_RES, WAVE_RES);
  const waveRT = [colorRT(WAVE_RES, WAVE_RES), colorRT(WAVE_RES, WAVE_RES)];
  let depthPack = null;

  function resizeDepth(w, h) {
    if (depthPack && depthPack.w === w && depthPack.h === h) return;
    if (depthPack) {
      gl.deleteFramebuffer(depthPack.fb);
      gl.deleteTexture(depthPack.color);
      gl.deleteTexture(depthPack.depth);
    }
    const color = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const depth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    depthPack = ok ? { fb: fb, color: color, depth: depth, w: w, h: h } : null;
  }

  function hex(s) {
    const n = parseInt(s.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  const COL = {
    deep: hex("#27a3d8"),
    mid: hex("#59c0e8"),
    hi: hex("#ffffff"),
    seaDeep: hex("#1aaae8"),
    seaHi: hex("#177096"),
    glass: hex("#de7d2f"),
    under: hex("#00121d"),
    fres: hex("#ffc900"),
    foam: hex("#a8e8ff"),
    spark: hex("#e5d2d2"),
    glow: hex("#88ccff"),
  };

  const SPARK_N = 100;
  const sparkPos = new Float32Array(SPARK_N * 3);
  const sparkLife = new Float32Array(SPARK_N);
  const sparkMax = new Float32Array(SPARK_N);
  const sparkSize = new Float32Array(SPARK_N);
  let seed = 7;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < SPARK_N; i++) {
    sparkPos[i * 3] = (rnd() - 0.5) * 36;
    sparkPos[i * 3 + 1] = WATER_Y + 0.97;
    sparkPos[i * 3 + 2] = (rnd() - 0.5) * 36;
    sparkMax[i] = 0.7 + rnd() * 2.1;
    sparkLife[i] = rnd() * sparkMax[i];
    sparkSize[i] = 3 + rnd() * 3;
  }
  const sparkPosBuf = buf(gl.ARRAY_BUFFER, sparkPos, gl.DYNAMIC_DRAW);
  const sparkLifeBuf = buf(gl.ARRAY_BUFFER, sparkLife, gl.DYNAMIC_DRAW);
  const sparkMaxBuf = buf(gl.ARRAY_BUFFER, sparkMax, gl.DYNAMIC_DRAW);
  const sparkSizeBuf = buf(gl.ARRAY_BUFFER, sparkSize, gl.DYNAMIC_DRAW);
  const sparkVAO = gl.createVertexArray();
  gl.bindVertexArray(sparkVAO);
  function attrib(b, loc, size) {
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
  attrib(sparkPosBuf, 0, 3);
  attrib(sparkLifeBuf, 3, 1);
  attrib(sparkMaxBuf, 4, 1);
  attrib(sparkSizeBuf, 5, 1);
  gl.bindVertexArray(null);

  const ripples = [];
  let prevBottom = null;
  let lastRippleT = -99;
  function pushRipple(x, z, t) {
    if (ripples.length >= 8) ripples.shift();
    ripples.push({ x: x, z: z, t: t });
  }
  function featherPose(t) {
    const bob = Math.sin(t * 0.65) * 0.07 + Math.sin(t * 1.4 + 0.8) * 0.02;
    const pitch = Math.sin(t * 0.5 + 0.3) * 0.06;
    const roll = Math.sin(t * 0.45 + 1.1) * 0.09 + Math.sin(t * 1.1) * 0.02;
    const yaw = Math.sin(t * 0.28) * 0.04;
    const pos = [-4.3, 0.05 + bob, -1.75];
    const rot = rotXYZ(pitch, -27 * DEG + yaw, roll);
    const bottom = pos[1] - 0.1;
    if (prevBottom === null) prevBottom = bottom;
    else {
      if (prevBottom > WATER_Y && bottom <= WATER_Y) {
        pushRipple(pos[0], pos[2], t);
        lastRippleT = t;
      }
      if (bottom < WATER_Y && t - lastRippleT > 2.3) {
        pushRipple(pos[0], pos[2], t);
        lastRippleT = t;
      }
      prevBottom = bottom;
    }
    return { pos: pos, rot: rot, model: modelFrom(rot, 9.3, pos) };
  }

  const dragonPos = [0.25, 1.1, -1.8];
  const dragonRot = rotXYZ(0, -2.7, 0);
  const dragonModel = modelFrom(dragonRot, 5.15, dragonPos);
  const waveSize = 5.15 * 2.7;

  let meshes = null;
  let time = 0;
  let ping = 0;
  let lastInject = -1e9;
  let readySent = false;
  let accum = 0;

  function assetName(file) {
    const path = location.pathname || "";
    const inVendor = /\/vendor\/(?:index\.html)?$/.test(path) || path.endsWith("/vendor/index.html");
    return (inVendor ? "" : "vendor/") + file;
  }

  function readAccessor(json, bin, index) {
    const acc = json.accessors[index];
    const bv = json.bufferViews[acc.bufferView];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
    const compSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
    const stride = bv.byteStride || comps * compSize;
    const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const count = acc.count;
    const floats = acc.componentType === 5126;
    const out = floats ? new Float32Array(count * comps) : new Uint32Array(count * comps);
    const abs = bin.byteOffset + start;
    if (!bv.byteStride && acc.componentType === 5126 && abs % 4 === 0) {
      out.set(new Float32Array(bin.buffer, abs, count * comps));
      return out;
    }
    if (!bv.byteStride && acc.componentType === 5123 && abs % 2 === 0) {
      const src = new Uint16Array(bin.buffer, abs, count * comps);
      for (let i = 0; i < src.length; i++) out[i] = src[i];
      return out;
    }
    for (let i = 0; i < count; i++) {
      const o = start + i * stride;
      for (let c = 0; c < comps; c++) {
        const p = o + c * compSize;
        let v = 0;
        if (acc.componentType === 5126) v = view.getFloat32(p, true);
        else if (acc.componentType === 5125) v = view.getUint32(p, true);
        else if (acc.componentType === 5123) v = view.getUint16(p, true);
        else if (acc.componentType === 5121) v = view.getUint8(p);
        out[i * comps + c] = v;
      }
    }
    return out;
  }

  async function imageTex(bytes, mime) {
    try {
      const copy = bytes.slice ? bytes.slice() : new Uint8Array(bytes);
      const blob = new Blob([copy], { type: mime || "image/png" });
      const bmp = await createImageBitmap(blob);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (bmp.close) bmp.close();
      return t;
    } catch (err) {
      return blackTex;
    }
  }

  async function loadGlb(file) {
    const res = await fetch(assetName(file));
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const dv = new DataView(ab);
    let off = 12;
    let json = null;
    let bin = null;
    while (off + 8 <= ab.byteLength) {
      const len = dv.getUint32(off, true);
      const type = dv.getUint32(off + 4, true);
      const chunk = new Uint8Array(ab, off + 8, len);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
      else if (type === 0x004e4942) bin = chunk;
      off += 8 + len;
    }
    if (!json || !bin) return null;
    const prims = [];
    const mesh = json.meshes[0];
    for (const prim of mesh.primitives) {
      const a = prim.attributes;
      const pos = readAccessor(json, bin, a.POSITION);
      const nrm = a.NORMAL != null ? readAccessor(json, bin, a.NORMAL) : null;
      const uv = a.TEXCOORD_0 != null ? readAccessor(json, bin, a.TEXCOORD_0) : null;
      const idx = readAccessor(json, bin, prim.indices);
      let map = blackTex;
      const mat = json.materials[prim.material || 0];
      const texIndex = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture
        ? mat.pbrMetallicRoughness.baseColorTexture.index
        : -1;
      if (texIndex >= 0) {
        const src = json.textures[texIndex].source;
        const image = json.images[src];
        const bv = json.bufferViews[image.bufferView];
        const start = bv.byteOffset || 0;
        const bytes = bin.subarray(start, start + bv.byteLength);
        map = await imageTex(bytes, image.mimeType);
      }
      prims.push({
        draw: meshVAO(pos, nrm, uv, idx),
        map: map,
      });
    }
    return prims;
  }

  function bindRT(rt) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
    gl.viewport(0, 0, rt.w, rt.h);
  }

  function drawElements(mesh) {
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
    gl.bindVertexArray(null);
  }

  function drawPlane(model, view, proj) {
    const mvp = mul(proj, mul(view, model));
    gl.uniformMatrix4fv(gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM), "uMVP"), false, mvp);
    gl.uniformMatrix4fv(gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM), "uModel"), false, model);
    drawElements(quad);
  }

  function simStep() {
    featherPose(time);
    const inject = time - lastInject >= 0.8;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.colorMask(true, true, true, true);
    if (inject && meshes && meshes.balls) {
      bindRT(injRT);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog.inj);
      gl.uniform1f(U.inj.uWaterY, WATER_Y);
      gl.uniform1f(U.inj.uBandWidth, 5);
      const eye = [dragonPos[0], 100, dragonPos[2]];
      const view = viewMatrix(eye, [dragonPos[0], 0, dragonPos[2]], [0, 0, -1]);
      const proj = ortho(-waveSize, waveSize, -waveSize, waveSize, 0.1, 200);
      const mvp = mul(proj, mul(view, dragonModel));
      gl.uniformMatrix4fv(U.inj.uMVP, false, mvp);
      gl.uniformMatrix4fv(U.inj.uModel, false, dragonModel);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      drawElements(meshes.balls[0].draw);
      drawElements(meshes.balls[2].draw);
      gl.disable(gl.CULL_FACE);
      lastInject = time;
    }
    const read = waveRT[ping];
    const write = waveRT[1 - ping];
    bindRT(write);
    gl.useProgram(prog.wave);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.tex);
    gl.uniform1i(U.wave.uWaveTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, injRT.tex);
    gl.uniform1i(U.wave.uInjection, 1);
    gl.uniform1f(U.wave.uTexelSize, TEXEL);
    gl.uniform1f(U.wave.uResolution, WAVE_RES);
    gl.uniform1f(U.wave.uSpeed, 0.08);
    gl.uniform1f(U.wave.uDamping, 0.993);
    gl.uniform1f(U.wave.uInjectStr, inject ? 0.21 : 0);
    gl.uniform1f(U.wave.uInjectAmp, 1);
    gl.uniform1f(U.wave.uBorderWidth, 0.06);
    gl.bindVertexArray(fsVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    ping = 1 - ping;
    time += 1 / 60;
  }

  function present() {
    const w = canvas.clientWidth | 0;
    const h = canvas.clientHeight | 0;
    if (w < 2 || h < 2) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * 0.22;
    const pw = Math.max(2, Math.round(w * dpr));
    const ph = Math.max(2, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    resizeDepth(pw, ph);
    const eye = camEye();
    const view = viewMatrix(eye, camTarget, [0, 1, 0]);
    const proj = perspective(50, pw / ph, 0.1, 200);
    const camXZ = [eye[0], eye[2]];
    const feather = featherPose(time);

    if (depthPack && meshes && meshes.balls) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, depthPack.fb);
      gl.viewport(0, 0, pw, ph);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog.depth);
      const mvp = mul(proj, mul(view, dragonModel));
      gl.uniformMatrix4fv(U.depth.uMVP, false, mvp);
      gl.uniformMatrix4fv(U.depth.uModel, false, dragonModel);
      drawElements(meshes.balls[0].draw);
      drawElements(meshes.balls[2].draw);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pw, ph);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.sky);
    gl.uniform1f(U.sky.uH, ph);
    gl.bindVertexArray(fsVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const seaModel = modelFrom(IDENT, 1, [eye[0], -1.6, eye[2]]);
    gl.useProgram(prog.floor);
    gl.uniform1f(U.floor.uTime, time);
    gl.uniform1f(U.floor.uScale, 0.16);
    gl.uniform1f(U.floor.uCellSpeed, 0.49);
    gl.uniform1f(U.floor.uFlowX, 0);
    gl.uniform1f(U.floor.uFlowZ, -0.11);
    gl.uniform1f(U.floor.uEdgeThreshold, 0.06);
    gl.uniform1f(U.floor.uEdgeSoftness, 0.03);
    gl.uniform3fv(U.floor.uDeepColor, COL.seaDeep);
    gl.uniform3fv(U.floor.uHighlight, COL.seaHi);
    gl.uniform1f(U.floor.uFadeDistance, 250);
    gl.uniform1f(U.floor.uFadeStrength, 2);
    gl.uniform2fv(U.floor.uCamXZ, camXZ);
    gl.uniformMatrix4fv(U.floor.uMVP, false, mul(proj, mul(view, seaModel)));
    gl.uniformMatrix4fv(U.floor.uModel, false, seaModel);
    drawElements(quad);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    if (meshes && meshes.balls) {
      gl.useProgram(prog.lit);
      gl.uniformMatrix4fv(U.lit.uMVP, false, mul(proj, mul(view, dragonModel)));
      gl.uniformMatrix4fv(U.lit.uModel, false, dragonModel);
      gl.uniformMatrix3fv(U.lit.uNmat, false, dragonRot);
      gl.uniform1f(U.lit.uCut, 0.02);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, meshes.balls[2].map);
      gl.uniform1i(U.lit.uMap, 0);
      drawElements(meshes.balls[2].draw);

      gl.useProgram(prog.star);
      gl.uniformMatrix4fv(U.star.uMVP, false, mul(proj, mul(view, dragonModel)));
      gl.uniformMatrix4fv(U.star.uModel, false, dragonModel);
      gl.uniformMatrix3fv(U.star.uNmat, false, dragonRot);
      drawElements(meshes.balls[1].draw);
    }
    if (meshes && meshes.feather) {
      gl.useProgram(prog.lit);
      gl.uniformMatrix4fv(U.lit.uMVP, false, mul(proj, mul(view, feather.model)));
      gl.uniformMatrix4fv(U.lit.uModel, false, feather.model);
      gl.uniformMatrix3fv(U.lit.uNmat, false, feather.rot);
      gl.uniform1f(U.lit.uCut, 0.1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, meshes.feather[0].map);
      gl.uniform1i(U.lit.uMap, 0);
      gl.disable(gl.CULL_FACE);
      drawElements(meshes.feather[0].draw);
    }
    if (meshes && meshes.balls && prog.glass) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.useProgram(prog.glass);
      gl.uniformMatrix4fv(U.glass.uMVP, false, mul(proj, mul(view, dragonModel)));
      gl.uniformMatrix4fv(U.glass.uModel, false, dragonModel);
      gl.uniformMatrix3fv(U.glass.uNmat, false, dragonRot);
      gl.uniform1f(U.glass.uTime, time);
      gl.uniform3fv(U.glass.uCam, eye);
      gl.uniform1f(U.glass.uWaterY, WATER_Y);
      gl.uniform1f(U.glass.uWaterLineSoftness, 0.02);
      gl.uniform1f(U.glass.uWaterLineWave, 0.04);
      gl.uniform3fv(U.glass.uWaterLineColor, COL.foam);
      gl.uniform3fv(U.glass.uGlassColor, COL.glass);
      gl.uniform1f(U.glass.uGlassOpacity, 0.85);
      gl.uniform3fv(U.glass.uUnderwaterColor, COL.under);
      gl.uniform1f(U.glass.uUnderwaterOpacity, 0.81);
      gl.uniform1f(U.glass.uFresnelPower, 2.7);
      gl.uniform1f(U.glass.uFresnelStrength, 3.65);
      gl.uniform3fv(U.glass.uFresnelColor, COL.fres);
      gl.uniform1f(U.glass.uRoughness, 0);
      drawElements(meshes.balls[0].draw);
      gl.disable(gl.CULL_FACE);
    }

    const waterModel = modelFrom(IDENT, 1, [eye[0], WATER_Y, eye[2]]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(prog.water);
    gl.uniform1f(U.water.uTime, time);
    gl.uniform1f(U.water.uScale, 0.23);
    gl.uniform1f(U.water.uSmoothness, 0.46);
    gl.uniform1f(U.water.uEdgeThreshold, 0.09);
    gl.uniform1f(U.water.uEdgeSoftness, 0.1);
    gl.uniform1f(U.water.uFlowX, 0.07);
    gl.uniform1f(U.water.uFlowZ, -0.23);
    gl.uniform1f(U.water.uCellSpeed, 0.55);
    gl.uniform1f(U.water.uNoiseScale, 0.87);
    gl.uniform1f(U.water.uNoiseFlowSpeed, 0.11);
    gl.uniform1f(U.water.uDistortAmount, 0.26);
    gl.uniform3fv(U.water.uDeepColor, COL.deep);
    gl.uniform3fv(U.water.uMidColor, COL.mid);
    gl.uniform1f(U.water.uMidPos, 0.31);
    gl.uniform3fv(U.water.uHighlight, COL.hi);
    gl.uniform1f(U.water.uOpacity, 1);
    gl.uniform1f(U.water.uDeepOpacity, 0.37);
    gl.uniform1f(U.water.uFadeDistance, 275);
    gl.uniform1f(U.water.uFadeStrength, 1.3);
    gl.uniform2fv(U.water.uCamXZ, camXZ);
    const centers = new Float32Array(16);
    const times = new Float32Array(8);
    for (let i = 0; i < ripples.length; i++) {
      centers[i * 2] = ripples[i].x;
      centers[i * 2 + 1] = ripples[i].z;
      times[i] = ripples[i].t;
    }
    gl.uniform2fv(U.water.uRippleCenters, centers);
    gl.uniform1fv(U.water.uRippleTimes, times);
    gl.uniform1i(U.water.uRippleCount, ripples.length);
    gl.uniform1f(U.water.uRippleSpeed, 1.5);
    gl.uniform1f(U.water.uRippleWidth, 0.12);
    gl.uniform1f(U.water.uRippleStrength, 5.5);
    gl.uniform1f(U.water.uRippleDecay, 1.6);
    gl.uniform1i(U.water.uRippleRings, 2);
    gl.uniform1f(U.water.uRippleSpacing, 1);
    gl.uniformMatrix4fv(U.water.uMVP, false, mul(proj, mul(view, waterModel)));
    gl.uniformMatrix4fv(U.water.uModel, false, waterModel);
    drawElements(quad);

    for (let i = 0; i < SPARK_N; i++) {
      sparkLife[i] += 1 / 60;
      sparkPos[i * 3 + 1] = WATER_Y + 0.97;
      if (sparkLife[i] >= sparkMax[i]) {
        sparkPos[i * 3] = eye[0] + (rnd() - 0.5) * 80;
        sparkPos[i * 3 + 2] = eye[2] + (rnd() - 0.5) * 80;
        sparkLife[i] = 0;
        sparkMax[i] = 0.7 + rnd() * 2.1;
        sparkSize[i] = 3 + rnd() * 3;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, sparkPosBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sparkPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, sparkLifeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sparkLife);
    gl.bindBuffer(gl.ARRAY_BUFFER, sparkMaxBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sparkMax);
    gl.bindBuffer(gl.ARRAY_BUFFER, sparkSizeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sparkSize);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.useProgram(prog.spark);
    gl.uniformMatrix4fv(U.spark.uView, false, view);
    gl.uniformMatrix4fv(U.spark.uProj, false, proj);
    gl.uniform3fv(U.spark.uColor, COL.spark);
    gl.uniform1f(U.spark.uIntensity, 1.8);
    gl.uniform1f(U.spark.uArmSharpness, 27);
    gl.uniform1f(U.spark.uArmFalloff, 4.8);
    gl.uniform1f(U.spark.uGlowRadius, 12);
    gl.bindVertexArray(sparkVAO);
    gl.drawArrays(gl.POINTS, 0, SPARK_N);
    gl.bindVertexArray(null);

    if (depthPack) {
      const hitModel = modelFrom(IDENT, 1, [eye[0], -0.095, eye[2]]);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(prog.hit);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, depthPack.depth);
      gl.uniform1i(U.hit.uDepthTex, 0);
      gl.uniform2f(U.hit.uResolution, pw, ph);
      gl.uniform1f(U.hit.uNear, 0.1);
      gl.uniform1f(U.hit.uFar, 200);
      gl.uniform1f(U.hit.uLineWidth, 0.25);
      gl.uniform1f(U.hit.uGlowWidth, 1.2);
      gl.uniform3fv(U.hit.uLineColor, COL.hi);
      gl.uniform1f(U.hit.uLineOpacity, 1);
      gl.uniform3fv(U.hit.uGlowColor, COL.glow);
      gl.uniform1f(U.hit.uGlowOpacity, 0.25);
      gl.uniformMatrix4fv(U.hit.uMVP, false, mul(proj, mul(view, hitModel)));
      gl.uniformMatrix4fv(U.hit.uModel, false, hitModel);
      drawElements(quad);
    }

    const dispModel = modelFrom(IDENT, 1, [eye[0], -0.092, eye[2]]);
    gl.useProgram(prog.disp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, waveRT[ping].tex);
    gl.uniform1i(U.disp.uWaveTex, 0);
    gl.uniform2f(U.disp.uCenter, dragonPos[0], dragonPos[2]);
    gl.uniform1f(U.disp.uWaveSize, waveSize);
    gl.uniform1f(U.disp.uTexelSize, TEXEL);
    gl.uniform1f(U.disp.uGradScale, 1);
    gl.uniform1f(U.disp.uRingThreshold, 0.54);
    gl.uniform1f(U.disp.uEdgeSharpness, 0.91);
    gl.uniform3fv(U.disp.uColor, COL.hi);
    gl.uniform1f(U.disp.uOpacity, 0.75);
    gl.uniformMatrix4fv(U.disp.uMVP, false, mul(proj, mul(view, dispModel)));
    gl.uniformMatrix4fv(U.disp.uModel, false, dispModel);
    drawElements(quad);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  function signalReady() {
    if (readySent) return;
    if (window.__gbSandbox && typeof window.__gbSandbox.ready === "function") {
      readySent = true;
      window.__gbSandbox.ready();
    }
  }

  const pointers = new Map();
  canvas.addEventListener("pointerdown", function (e) {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener("pointerup", function (e) { pointers.delete(e.pointerId); });
  canvas.addEventListener("pointercancel", function (e) { pointers.delete(e.pointerId); });
  canvas.addEventListener("pointermove", function (e) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const ids = Array.from(pointers.keys());
    if (ids.length === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      camAz -= dx * 0.005;
      const next = camPol + dy * 0.004;
      camPol = next < 10 * DEG ? 10 * DEG : next > 85 * DEG ? 85 * DEG : next;
    } else if (ids.length >= 2) {
      const a = pointers.get(ids[0]);
      const b = pointers.get(ids[1]);
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const a2 = pointers.get(ids[0]);
      const b2 = pointers.get(ids[1]);
      const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (before > 0 && after > 0) {
        const next = camRadius * (before / after);
        camRadius = next < 3 ? 3 : next > 40 ? 40 : next;
      }
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });

  function frame(now) {
    if (!frame.t0) frame.t0 = now;
    const dt = Math.min(0.05, (now - (frame.prev || now)) / 1000);
    frame.prev = now;
    accum += dt;
    if (accum >= 1 / 60) {
      simStep();
      accum = 0;
    }
    if (present()) signalReady();
    setTimeout(function () { requestAnimationFrame(frame); }, 100);
  }

  function clearWave() {
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    for (let i = 0; i < 2; i++) {
      bindRT(waveRT[i]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    bindRT(injRT);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  async function boot() {
    clearWave();
    let balls = null;
    let feather = null;
    try {
      balls = await loadGlb("dragon-balls-model.glb");
      feather = await loadGlb("feather.glb");
    } catch (err) {
      balls = null;
      feather = null;
    }
    meshes = { balls: balls, feather: feather };
    for (let i = 0; i < 2; i++) simStep();
    requestAnimationFrame(frame);
  }
  boot();
})();
