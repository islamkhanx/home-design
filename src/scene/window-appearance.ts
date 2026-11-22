import * as T from 'three'

const skyColor = new T.Color('#dce8f5').multiplyScalar(0.56)
const skyVisibility = new WeakMap<T.MeshPhysicalMaterial, { value: number }>()

/** Show the visible sky only at enabled exterior panes. The lighting rig supplies its energy. */
export function updateWindowAppearance(
  root: T.Group,
  exteriorWindowIds: readonly string[],
  activeWindowIds: readonly string[],
) {
  const exterior = new Set(exteriorWindowIds)
  const active = new Set(activeWindowIds)
  root.traverse(object => {
    if (!(object instanceof T.Mesh) || !object.userData.windowPane ||
        !(object.material instanceof T.MeshPhysicalMaterial)) return
    const isExterior = exterior.has(object.userData.entityId)
    let visibility = skyVisibility.get(object.material)
    if (isExterior && !visibility) {
      const material = object.material.clone()
      const uniform = { value: 0 }
      material.onBeforeCompile = shader => {
        shader.uniforms.apertureSkyVisibility = uniform
        shader.uniforms.apertureSkyColor = { value: skyColor }
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform float apertureSkyVisibility;
            uniform vec3 apertureSkyColor;`)
          .replace('#include <transmission_fragment>', `#include <transmission_fragment>
            #ifdef USE_TRANSMISSION
              totalDiffuse = mix(totalDiffuse, apertureSkyColor, apertureSkyVisibility * material.transmission);
            #endif`)
      }
      skyVisibility.set(material, uniform)
      object.material = material
      visibility = uniform
    }
    if (visibility) visibility.value = isExterior && active.has(object.userData.entityId) ? 1 : 0
  })
}
