import { DropletIcon, FuelIcon, GaugeIcon } from "lucide-react";

export default function StatusBar() {
  return (
    <div className="flex items-center justify-between max-w-md mx-auto bg-white shadow-md border border-gray-200 rounded-2xl p-2 space-x-4 hover:border-gray-300">
      {/* Fuel Level */}
      <div className="flex items-center space-x-2">
        <FuelIcon className="w-6 h-6 text-yellow-500" />
        <span className="text-sm font-semibold text-gray-700">30%</span>
      </div>

      {/* Speed */}
      <div className="flex items-center space-x-2">
        <GaugeIcon className="w-6 h-6 text-green-500" />
        <span className="text-sm font-semibold text-gray-700">12 km/h</span>
      </div>

      {/* Water Level */}
      <div className="flex items-center space-x-2">
        <DropletIcon className="w-6 h-6 text-blue-500" />
        <span className="text-sm font-semibold text-gray-700">13%</span>
      </div>

      {/* Status Badge */}
      <div>
        <span className="inline-block bg-orange-500 text-white text-xs font-semibold uppercase px-4 py-1 rounded-full shadow-sm">
          Running
        </span>
      </div>
    </div>
  );
}
