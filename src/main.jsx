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
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
