import { COMMODITIES, CROP_NAMES } from "@/lib/regions";
import { useCrop } from "./crop";

/** The one control that picks the crop every panel shows. */
export function CropSwitcher() {
  const crop = useCrop((state) => state.crop);
  const setCrop = useCrop((state) => state.setCrop);
  return (
    <div className="crop-switcher" role="group" aria-label="Crop">
      {COMMODITIES.map((symbol) => (
        <button key={symbol} type="button" aria-pressed={crop === symbol} title={`${symbol} futures`} onClick={() => setCrop(symbol)}>
          {CROP_NAMES[symbol] ?? symbol}
        </button>
      ))}
    </div>
  );
}
