import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { DataPanel } from './components/DataPanel';
import { ProcessDiagram } from './components/ProcessDiagram';
import { SimulationState, SimulationControls } from './types';
import { api, ConnectionStatus } from './services/api';
import { resetDamage } from './services/mockSimulation';
import { Activity, LayoutDashboard, Server, PanelsTopBottom, ChevronDown, GripHorizontal } from 'lucide-react';

const App: React.FC = () => {
  // Connection State
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  
  // Layout State
  const [showPanel, setShowPanel] = useState(true);
  const [panelHeight, setPanelHeight] = useState(300);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(0);

  // Data State
  const [simState, setSimState] = useState<SimulationState>({
    Q_wellfield: 0,
    Q_feed: 0,
    Q_perm: 0,
    Q_brine: 0,
    Q_out: 0,
    level_feed_tank: 0,
    level_clearwell: 0,
    V_clearwell: 0,
    TDS_feed: 0,
    TDS_perm: 0,
    pH_true: 7.0,
    Cl_true: 0.0,
    H2S_feed: 0,
    H2S_out: 0,
    pressure_well: 0,
    dP_ro_true: 0,
    pressure_feed: 0,
    pressure_dist: 0,
    membrane_health: 100,
    pump_well_health: 100,
    pump_feed_health: 100,
    pump_dist_health: 100,
    pipe_well_health: 100,
    pipe_feed_health: 100,
    pipe_dist_health: 100,
  });

  const [controls, setControls] = useState<SimulationControls>({
    wellfield_on: false,
    ro_feed_pump_on: false,
    dist_pump_on: false,
    
    // Default closed on init for safety until API connects
    valve_101_open: false,
    valve_201_open: false,
    valve_202_open: false,
    valve_203_open: false,
    valve_401_open: false,

    naoh_pump_on: false,
    cl_pump_on: false,
    NaOH_dose: 0,
    Cl_dose: 0,
    Q_out_sp: 0,
  });

  // Connect to Backend on Mount
  useEffect(() => {
    api.connect(
      (data) => {
        setSimState(data.state);
        setControls(data.controls);
      },
      (newStatus) => setStatus(newStatus)
    );

    return () => {
      api.disconnect();
    };
  }, []);

  // Panel Resizing Logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaY = dragStartY.current - e.clientY;
      const newHeight = Math.max(150, Math.min(window.innerHeight - 200, dragStartHeight.current + deltaY));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = 'default';
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const startResize = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = panelHeight;
  };

  // Handlers
  const handleToggle = useCallback((key: keyof SimulationControls) => {
    const newValue = !controls[key];
    setControls(prev => ({ ...prev, [key]: newValue }));
    api.sendControl(key, Number(newValue));
  }, [controls]);

  const handleUpdate = useCallback((key: keyof SimulationControls, value: number) => {
    setControls(prev => ({ ...prev, [key]: value }));
    api.sendControl(key, value);
  }, []);

  const handleEmergencyStop = useCallback(() => {
    const keys: (keyof SimulationControls)[] = [
      'wellfield_on', 'ro_feed_pump_on', 'dist_pump_on',
      'valve_101_open', 'valve_201_open', 'valve_202_open', 'valve_203_open', 'valve_401_open',
      'naoh_pump_on', 'cl_pump_on'
    ];
    keys.forEach(k => api.sendControl(k, 0));
    api.sendControl('NaOH_dose', 0);
    api.sendControl('Cl_dose', 0);
    api.sendControl('Q_out_sp', 0);
  }, []);

  const handleReset = useCallback(() => {
    // Pumps
    api.sendControl('wellfield_on', 1);
    api.sendControl('ro_feed_pump_on', 1);
    api.sendControl('dist_pump_on', 1);
    
    // Valves (Open all for normal ops)
    api.sendControl('valve_101_open', 1);
    api.sendControl('valve_201_open', 1);
    api.sendControl('valve_202_open', 1);
    api.sendControl('valve_203_open', 1);
    api.sendControl('valve_401_open', 1);

    // Dosing Pumps
    api.sendControl('naoh_pump_on', 1);
    api.sendControl('cl_pump_on', 1);

    // Setpoints
    api.sendControl('NaOH_dose', 5.0);
    api.sendControl('Cl_dose', 1.0);
    api.sendControl('Q_out_sp', 80.0);
  }, []);

  const handleResetDamage = useCallback(() => {
    resetDamage();
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-100 font-sans text-slate-700">
      
      {/* Top Header */}
      <header className="h-14 bg-scada-nav text-white flex items-center justify-between px-6 shrink-0 z-30 shadow-md">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-white/10 rounded-lg">
               <Activity className="text-sky-300" size={20} />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-wide uppercase leading-none">AquaFlow Scada</h1>
              <span className="text-[10px] text-sky-200 uppercase font-medium">Plant Control Interface</span>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
             {/* Panel Toggle Button */}
             <button 
                onClick={() => setShowPanel(!showPanel)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-bold uppercase tracking-wider transition-all
                  ${showPanel ? 'bg-sky-700 border-sky-600 text-white' : 'bg-white/10 border-white/20 text-sky-100 hover:bg-white/20'}
                `}
             >
                <PanelsTopBottom size={14} />
                {showPanel ? 'Hide Panel' : 'Show Panel'}
             </button>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-black/20 rounded-md border border-white/10">
              <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]' : 'bg-red-500 animate-pulse'}`}></div>
              <span className="text-xs font-mono font-medium text-sky-100 uppercase">{status}</span>
            </div>

            <div className="text-right border-l border-white/10 pl-6 hidden sm:block">
              <div className="text-[10px] text-sky-300 font-bold uppercase tracking-wider">Train A</div>
              <div className="text-xs font-bold text-white">Online</div>
            </div>
          </div>
      </header>

      {/* Main Content Area (Fill remaining height) */}
      <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
          
          {/* Diagram Section */}
          <div className="flex-1 bg-white relative overflow-hidden flex flex-col m-2 rounded-xl shadow-sm border border-slate-200">
             <div className="absolute top-0 left-0 w-full h-8 bg-slate-50 border-b border-slate-100 flex items-center px-4 justify-between z-10">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <LayoutDashboard size={12} /> Live Process Diagram
                </span>
                <span className="text-[10px] font-mono text-slate-300">{new Date().toISOString().split('T')[0]}</span>
             </div>
             
             {/* 
                CRITICAL FIX: 
                Use overflow-hidden + w-full h-full to force the SVG (with preserveAspectRatio) 
                to shrink-to-fit instead of causing scrollbars.
             */}
             <div className="flex-1 w-full h-full relative overflow-hidden p-1">
                <ProcessDiagram state={simState} controls={controls} />
             </div>
          </div>

          {/* Resizer Handle */}
          {showPanel && (
            <div 
               className="h-2 bg-slate-100 hover:bg-sky-100 border-t border-b border-slate-200 cursor-row-resize flex items-center justify-center transition-colors z-20 shrink-0 select-none group"
               onMouseDown={startResize}
            >
               <GripHorizontal size={16} className="text-slate-300 group-hover:text-sky-400" />
            </div>
          )}

          {/* Bottom Panel (Fixed or Resizable Height) */}
          {showPanel && (
          <footer style={{ height: panelHeight }} className="bg-white shrink-0 flex z-20 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.05)] transition-all duration-75 ease-out">
              {/* Controls Section (40%) */}
              <div className="w-5/12 border-r border-slate-200 flex flex-col min-w-[350px] bg-slate-50/50">
                <div className="px-4 py-2 border-b border-slate-200 bg-white flex justify-between items-center">
                  <span className="text-xs font-bold text-scada-nav uppercase flex items-center gap-2">
                    <Server size={14} /> Manual Control
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 custom-scrollbar">
                  <ControlPanel 
                    controls={controls}
                    onToggle={handleToggle}
                    onUpdate={handleUpdate}
                    onEmergencyStop={handleEmergencyStop}
                    onReset={handleReset}
                    onResetDamage={handleResetDamage}
                  />
                </div>
              </div>

              {/* Data Section (60%) */}
              <div className="w-7/12 flex flex-col min-w-[500px] bg-white">
                <div className="px-4 py-2 border-b border-slate-200 bg-white flex justify-between items-center">
                   <span className="text-xs font-bold text-slate-500 uppercase">Live Telemetry</span>
                </div>
                <div className="flex-1 overflow-auto p-3 custom-scrollbar">
                   <DataPanel state={simState} />
                </div>
              </div>
          </footer>
          )}
      </div>
    </div>
  );
};

export default App;