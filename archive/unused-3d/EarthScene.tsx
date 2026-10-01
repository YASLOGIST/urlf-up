import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Earth3D } from './Earth3D'
import './EarthScene.css'

gsap.registerPlugin(ScrollTrigger)

export function EarthScene() {
  const sectionRef = useRef<HTMLElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const statRef = useRef<HTMLDivElement>(null)
  const scrollProgress = useRef(0)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const ctx = gsap.context(() => {
      // Master scroll progress driver — feeds the 3D scene
      ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: 'bottom top',
        scrub: 1.2,
        onUpdate: (self) => {
          scrollProgress.current = self.progress
        },
      })

      // Hero overlay — fade & lift on scroll
      if (overlayRef.current) {
        gsap.to(overlayRef.current, {
          opacity: 0,
          y: -60,
          ease: 'power2.in',
          scrollTrigger: {
            trigger: section,
            start: 'top top',
            end: '45% top',
            scrub: 1,
          },
        })
      }

      // Stats panel — slide in as Earth scales up
      if (statRef.current) {
        gsap.fromTo(
          statRef.current,
          { opacity: 0, y: 80 },
          {
            opacity: 1,
            y: 0,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: section,
              start: '55% top',
              end: '85% top',
              scrub: 1,
            },
          },
        )
      }
    }, section)

    return () => {
      ctx.revert()
      ScrollTrigger.getAll().forEach((t) => t.kill())
    }
  }, [])

  return (
    <section ref={sectionRef} className="earth-section">
      <div className="earth-canvas-wrapper">
        <Canvas
          camera={{ position: [0, 0, 6], fov: 50 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          dpr={[1, 2]}
        >
          <ambientLight intensity={0.18} />
          <directionalLight position={[5, 3, 5]} intensity={1.1} color="#FFD700" />
          <pointLight position={[-6, -3, -5]} intensity={0.6} color="#FF3D00" />
          <pointLight position={[0, 4, 3]} intensity={0.3} color="#D4AF37" />
          <Earth3D scrollProgress={scrollProgress} />
        </Canvas>
      </div>

      {/* Hero overlay — top of scroll */}
      <div ref={overlayRef} className="earth-overlay earth-overlay--top">
        <div className="glass-panel">
          <span className="elite-tag">[ ELITE GLOBAL OPERATING SYSTEM ]</span>
          <h1 className="elite-title">
            COMMAND <span className="gold-text">THE WORLD</span>
          </h1>
          <p className="elite-subtitle">
            Capital deployed across continents. Decisions executed in milliseconds.
            Engineered for the 0.001%.
          </p>
          <div className="elite-cta">
            <button className="btn-primary">INITIATE ACCESS</button>
            <button className="btn-ghost">EXPLORE DOCTRINE</button>
          </div>
        </div>
      </div>

      {/* Stats panel — appears as Earth zooms */}
      <div ref={statRef} className="earth-overlay earth-overlay--bottom">
        <div className="glass-panel glass-panel--stats">
          <div className="stat">
            <span className="stat-value gold-text">$100M+</span>
            <span className="stat-label">Capital Deployed</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value gold-text">5,000 KG</span>
            <span className="stat-label">Hard Reserve</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value gold-text">10 Cities</span>
            <span className="stat-label">Active Nodes</span>
          </div>
        </div>
      </div>
    </section>
  )
}

export default EarthScene
