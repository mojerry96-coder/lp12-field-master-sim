import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'

// Draco decodes locally, not from a CDN.
//
// drei defaults to https://www.gstatic.com/draco/... which puts a third-party
// round trip on the critical path of the largest asset in the simulation, and
// fails outright on a restricted network — not a reasonable dependency for a
// university training module. The decoder ships with three; it is copied to
// public/draco/ and served with the rest of the app.
useGLTF.setDecoderPath('/draco/')

// three's file cache, on.
//
// Off by default, which means every loader that asks for a URL re-fetches it.
// The preloader and drei both load the same GLBs, and without this the second
// one goes back to the network — cheap on localhost, not on a lecture-hall
// connection. With it, whoever asks second reads the buffer already in memory.
THREE.Cache.enabled = true

import './index.css'
import './styles/install.css'
import './styles/opener.css'
// The Apple-glass redesign. Tokens first — everything below reads from them.
import './styles/tokens.css'
import './styles/field-master.css'
import './styles/page01.css'
import './styles/page02.css'
import './styles/assembly-stage.css'
import './styles/page11.css'
import './styles/page12.css'
import './styles/page13.css'
import './styles/page14.css'
import './styles/tuning-step.css'
import './styles/network-test.css'
import './styles/page18.css'
import './styles/page19.css'
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
