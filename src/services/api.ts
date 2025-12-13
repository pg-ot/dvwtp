import { SimulationState, SimulationControls } from '../types';
import { simulatePhysics } from './mockSimulation';

// Connection status
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface ApiPayload {
  time_s: number;
  state: SimulationState;
  controls: SimulationControls;
}

export class PlantApi {
  private timer: number | null = null;
  private backendAvailable: boolean = false;
  
  private currentControls: SimulationControls = {
    wellfield_on: false,
    ro_feed_pump_on: false,
    dist_pump_on: false,
    
    // Default Valves Open
    valve_101_open: true,
    valve_201_open: true,
    valve_202_open: true,
    valve_203_open: true,
    valve_401_open: true,

    naoh_pump_on: false,
    cl_pump_on: false,
    NaOH_dose: 5.0,
    Cl_dose: 1.0,
    Q_out_sp: 80.0,
  };

  connect(
    onData: (data: ApiPayload) => void,
    onStatus: (status: ConnectionStatus) => void
  ) {
    if (this.timer) clearInterval(this.timer);
    
    onStatus('connecting');

    // Start Simulation Loop (10Hz)
    this.timer = window.setInterval(async () => {
        let newState: SimulationState;
        let useLocalSim = false;
        
        // 1. Try to connect to Python Digital Twin
        try {
            const response = await fetch('http://localhost:5000/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ controls: this.currentControls }),
                signal: AbortSignal.timeout(200)
            });

            if (response.ok) {
                const data = await response.json();
                newState = data.state;
                
                if (!this.backendAvailable) {
                    this.backendAvailable = true;
                    console.log("✓ Connected to Python Digital Twin");
                }
            } else {
                throw new Error('Backend unavailable');
            }
        } catch (e) {
            // 2. Fallback to Local JavaScript Simulation
            if (this.backendAvailable) {
                console.log("⚠ Python Digital Twin offline, using local simulation");
                this.backendAvailable = false;
            }
            newState = simulatePhysics(this.currentControls, 0.1);
            useLocalSim = true;
        }

        // 3. Update UI Status
        onStatus(this.backendAvailable ? 'connected' : 'connected');
        
        // 4. Send Data to UI
        onData({
            time_s: Date.now() / 1000,
            state: newState,
            controls: this.currentControls
        });

    }, 100);
  }

  disconnect() {
    if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
    }
  }

  async sendControl(control: keyof SimulationControls, value: number | boolean) {
    // If Backend is driving, manual boolean overrides might be overwritten in the next tick
    // But we update local state anyway for immediate feedback or if backend is down.
    
    const isBooleanControl = [
      'wellfield_on', 'ro_feed_pump_on', 'dist_pump_on',
      'valve_101_open', 'valve_201_open', 'valve_202_open', 'valve_203_open', 'valve_401_open',
      'naoh_pump_on', 'cl_pump_on'
    ].includes(control);

    if (isBooleanControl) {
      this.currentControls = {
        ...this.currentControls,
        [control]: value === 1 || value === true
      };
    } else {
      this.currentControls = {
        ...this.currentControls,
        [control]: Number(value)
      };
    }

    return Promise.resolve();
  }
}

export const api = new PlantApi();