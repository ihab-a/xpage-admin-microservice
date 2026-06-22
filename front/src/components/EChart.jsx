import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export default function EChart({ option, style, onChartReady }) {
  const elRef    = useRef(null);
  const chartRef = useRef(null);
  const ready    = useRef(false);

  // init + update
  useEffect(() => {
    if (!elRef.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(elRef.current);
    }
    if (!ready.current) {
      chartRef.current.setOption(option, true); // full replace on first render
      ready.current = true;
      onChartReady?.(chartRef.current); // after setOption so toolbox is ready
    } else {
      // preserve dataZoom / brush state, replace series by index
      chartRef.current.setOption(option, { replaceMerge: ['series'] });
    }
  }, [option]); // eslint-disable-line react-hooks/exhaustive-deps

  // resize
  useEffect(() => {
    if (!elRef.current) return;
    const obs = new ResizeObserver(() => chartRef.current?.resize());
    obs.observe(elRef.current);
    return () => obs.disconnect();
  }, []);

  // cleanup
  useEffect(() => () => { chartRef.current?.dispose(); chartRef.current = null; }, []);

  return <div ref={elRef} style={style} />;
}
