import Scene3D from "./components/Scene3D";
import StatusBar from "./components/StatusBar";

function App() {
  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col">
      <h1 className="text-center mt-4 mb-2 text-3xl font-bold">
        Raymond <span className="text-2xl text-gray-400">(SB-0026)</span>
      </h1>
      <Scene3D />
      <StatusBar />
    </div>
  );
}

export default App;
