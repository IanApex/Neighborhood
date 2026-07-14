import { ref, onMounted, onUnmounted } from 'vue';

// Reactive prefers-reduced-motion. The reduced experience is the same truth
// in print form — static small multiples, plain fades — never a lesser mode.
export function useReducedMotion() {
  // Read synchronously: components must mount directly into the right mode,
  // never render the animated variant for a frame and then swap.
  const mql = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = ref(mql?.matches ?? false);
  const update = () => (reduced.value = mql.matches);
  onMounted(() => mql?.addEventListener('change', update));
  onUnmounted(() => mql?.removeEventListener('change', update));
  return reduced;
}

// IntersectionObserver reveal: adds .in when the element enters the viewport.
// The ONLY scroll mechanic outside Built (which alone may scrub).
export function observeReveals(root) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  );
  for (const el of root.querySelectorAll('.reveal')) io.observe(el);
  return io;
}
