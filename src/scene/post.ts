import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * Cinematic finish: HDR scene -> bloom on the brightest light (lava, sun glint, crater glow)
 * -> lens vignette and fine film grain -> ACES filmic tone mapping and sRGB output.
 */
export function buildPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const render = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.4, 2.6);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 16 / 9 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime, uAspect; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 q = (vUv - .5) * vec2(uAspect, 1.);
        c.rgb *= mix(1., .72, smoothstep(.45, 1.25, length(q)));
        c.rgb += (h(vUv * 1000. + uTime) - .5) * .012 * (c.rgb + .02);
        gl_FragColor = c;
      }`,
  });
  composer.addPass(render);
  composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  // Offscreen stills (View tab previews): HDR render, then tone map and encode in one quad pass.
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uExposure: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc; uniform float uExposure; varying vec2 vUv;
      vec3 aces(vec3 c){
        c *= uExposure / .6;
        const mat3 m1 = mat3(.59719, .07600, .02840, .35458, .90834, .13383, .04823, .01566, .83777);
        const mat3 m2 = mat3(1.60475, -.10208, -.00327, -.53108, 1.10813, -.07276, -.07367, -.00605, 1.07602);
        c = m1 * c;
        vec3 a = c * (c + .0245786) - .000090537;
        vec3 b = c * (.983729 * c + .4329510) + .238081;
        return clamp(m2 * (a / b), 0., 1.);
      }
      void main(){
        vec3 c = aces(texture2D(tSrc, vUv).rgb);
        c = mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c));
        gl_FragColor = vec4(c, 1.);
      }`,
    depthTest: false,
  });
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));

  return {
    capture(cam: THREE.Camera, w: number, h: number) {
      const hdr = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
      const ldr = new THREE.WebGLRenderTarget(w, h);
      const prevTM = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(hdr);
      renderer.render(scene, cam);
      quadMat.uniforms.tSrc.value = hdr.texture;
      quadMat.uniforms.uExposure.value = renderer.toneMappingExposure;
      renderer.setRenderTarget(ldr);
      renderer.render(quadScene, quadCam);
      const buf = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(ldr, 0, 0, w, h, buf);
      renderer.setRenderTarget(null);
      renderer.toneMapping = prevTM;
      hdr.dispose();
      ldr.dispose();
      return buf;
    },
    composer,
    bloom,
    setCamera(c: THREE.Camera) {
      render.camera = c;
    },
    setSize(w: number, h: number, dpr: number) {
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      grade.uniforms.uAspect.value = w / h;
    },
    render(t: number, useBloom: boolean) {
      bloom.enabled = useBloom;
      grade.uniforms.uTime.value = t % 100;
      composer.render();
    },
  };
}
