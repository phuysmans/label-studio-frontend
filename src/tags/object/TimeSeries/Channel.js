import "moment-duration-format";
import React from "react";
import _ from "underscore";
import moment from "moment";
import { Button, Icon } from "antd";
import { Slider } from "antd";
import { TimeSeries, TimeRange, avg, percentile, median } from "pondjs";
import { format } from "d3-format";
import { observer, inject } from "mobx-react";
import { types, getParent } from "mobx-state-tree";

import {
  AreaChart,
  Baseline,
  BoxChart,
  Brush,
  ChartContainer,
  ChartRow,
  Charts,
  LabelAxis,
  LineChart,
  Resizable,
  ValueAxis,
  YAxis,
  styler,
  Legend,
  TimeMarker,
  MultiBrush,
} from "react-timeseries-charts";

import ObjectBase from "../Base";
import ObjectTag from "../../../components/Tags/Object";
import Registry from "../../../core/Registry";
import Types from "../../../core/Types";
import { guidGenerator, restoreNewsnapshot } from "../../../core/Helpers";
import { runTemplate } from "../../../core/Template";

/**
 * TimeSeriesChannel tag can be used to label time series data
 * @example
 * <View>
 *   <TimeSeries name="video" value="$timestamp">
 *      <TimeSeriesChannel value="$sensor1" />
 *      <TimeSeriesChannel value="$sensor2" />
 *   </TimeSeries>
 * </View>
 * @param {string} displayName name of the channel
 * @param {string} units units name
 * @param {string} unitsFormat format string for the units
 * @param {string} caption show channel caption view, like channel name, etc
 * @param {string} interpolation line interpolation mode
 * @param {string} showGrid show grid on the plot
 * @param {string} showTracker show tracker line on the plot
 * @param {string} height height of the plot
 * @param {string} opacity opacity of the line
 * @param {string=} [strokeColor=#f48a42] stroke color
 * @param {number=} [strokeWidth=1] width of the stroke
 * @param {string} value value
 */

const csMap = {
  curvestep: "curveStep",
  curvebasis: "curvebasis",
  curvebasisopen: "curveBasisOpen",
  curvebundle: "curveBundle",
  curvecardinal: "curveCardinal",
  curvecardinalopen: "curveCardinalOpen",
  curvecatmullrom: "curveCatmullRom",
  curvecatmullromopen: "curveCatmullRomOpen",
  curvelinear: "curveLinear",
  curvemonotonex: "curveMonotoneX",
  curvemonotoney: "curveMonotoneY",
  curvenatural: "curveNatural",
  curveradial: "curveRadial",
  curvestep: "curveStep",
  curvestepafter: "curveStepAfter",
  curvestepbefore: "curveStepBefore",
};

const TagAttrs = types.model({
  displayname: types.maybeNull(types.string),

  units: types.maybeNull(types.string),
  unitsformat: types.optional(types.string, ".1f"),
  caption: types.optional(types.boolean, true), // show channel caption view, like channel name, etc

  interpolation: types.optional(types.enumeration(Object.values(csMap)), "curveStep"),

  showgrid: types.optional(types.boolean, false),
  showtracker: types.optional(types.boolean, true),

  height: types.optional(types.string, "200"),

  opacity: types.optional(types.string, "0.8"),
  strokewidth: types.optional(types.string, "1"),
  strokecolor: types.optional(types.string, "#000000"),

  value: types.maybeNull(types.string),
});

const Model = types
  .model("TimeSeriesChannelModel", {
    id: types.optional(types.identifier, guidGenerator),
    type: "timeserieschannel",
    children: Types.unionArray(["channel", "view"]),
    // _value: types.optional(types.string, ""),
  })
  .views(self => ({
    get parent() {
      return Types.getParentOfTypeString(self, "TimeSeriesModel");
    },
  }))
  .preProcessSnapshot(snapshot => {
    snapshot.interpolation = csMap[snapshot.interpolation];
    return snapshot;
  })
  .actions(self => ({
    handleTrackerChanged(t) {
      self.tracker = t;
      self.parent.updateView();
    },

    updateValue(store) {
      self._value = runTemplate(self.value, store.task.dataObj, { raw: true });

      const points = [];

      for (let i = 0; i <= self.parent._value[0][i]; i++) {
        points.push([self.parent._value[0][i], self._value[0][i]]);
      }

      const series = new TimeSeries({
        columns: ["time", self.value],
        points: points,
      });

      // Some simple statistics for each channel
      self._avg = parseInt(series.avg(self.value), 10);
      self._max = parseInt(series.max(self.value), 10);
      self._min = parseInt(series.min(self.value), 10);
      self._series = series;

      self._minTime = series.range().begin();
      self._maxTime = series.range().end();
    },
  }));

const TimeSeriesChannelModel = types.compose("TimeSeriesChannelModel", Model, TagAttrs, ObjectBase);

const HtxTimeSeriesChannelView = observer(({ store, item }) => {
  if (!item._value) return null;

  const u = item.parent._needsUpdate;
  const timerange = item.parent.initialRange;
  const maxTime = item._maxTime;
  const minTime = item._minTime;
  const minDuration = 10 * 60 * 1000;
  const durationPerPixel = timerange.duration() / 800 / 1000;
  const dn = item.displayname;

  const style = {};
  style[item.value] = {
    normal: {
      stroke: item.strokecolor,
      strokeWidth: parseInt(item.strokewidth),
      opacity: parseFloat(item.opacity),
    },
  };

  const charts = [
    <LineChart
      key={`line-${item.value}-{$u}`}
      axis={`${item.value}_axis`}
      series={item._series}
      interpolation={item.interpolation}
      style={style}
      columns={[item.value]}
      // style={style}
      breakLine
    />,
    <MultiBrush
      key={`mb-${item.value}-{$u}`}
      timeRanges={item.parent.regionsTimeRanges}
      style={i => {
        let col = "#cccccc";
        const r = item.parent.regions[i];

        if (r) {
          if (r.selected || r.highlighted) {
            col = "#ff0000";
          } else {
            col = r.states[0].getSelectedColor();
          }
        }

        return { fill: col };
      }}
      allowSelectionClear
      onTimeRangeChanged={(timerange, i) => {
        item.parent.regionChanged(timerange, i);
        item.parent.updateView();
      }}
      onTimeRangeClicked={i => {
        const r = item.parent.regions[i];
        item.parent.completion.regionStore.unselectAll();

        if (r) {
          r.selectRegion();
          item.parent.updateView();
        }
      }}
      /* onTimeRangeClicked={i => this.setState({ selected: i })} */
    />,
  ];

  // Get the value at the current tracker position for the ValueAxis
  let value = "--";
  const series = item._series;

  const getValue = function() {
    if (!item.tracker) return;

    const approx = (+item.tracker - +timerange.begin()) / (+timerange.end() - +timerange.begin());
    const ii = Math.floor(approx * series.size());
    const i = series.bisect(new Date(item.tracker), ii);

    try {
      return series.at(i).get(item.value);
    } catch {
      return null;
    }
  };

  const uval = getValue();

  value = item.tracker && uval;

  const showtracker = item.showtracker && uval;

  const formatFn = format(item.unitsformat);

  const summary = [
    { label: "Max", value: formatFn(item._max) },
    { label: "Avg", value: formatFn(item._avg) },
    { label: "Min", value: formatFn(item._min) },
  ];

  const rows = [];
  const r = item._series.range();

  const trackerInfoValues = (function() {
    const label = item.units ? item.units : "value";
    const value = item.tracker ? getValue() : "--";

    return [{ label, value }];
  })();

  return (
    <Resizable>
      <ChartContainer
        trackerPosition={showtracker ? item.tracker : null}
        onTrackerChanged={item.handleTrackerChanged}
        timeRange={item.parent.initialRange}
        enablePanZoom={false}
        utc={true}
        showGrid={item.showgrid}
        onTimeRangeChanged={item.parent.updateTR}
        maxTime={r.end()}
        minTime={r.begin()}
        minDuration={60000}
      >
        <ChartRow
          height={item.height}
          key={`row-${item.value}`}
          trackerInfoValues={!item.units && trackerInfoValues}
          trackerInfoHeight={10 + trackerInfoValues.length * 16}
          trackerInfoWidth={140}
        >
          <LabelAxis
            id={`${item.value}_axis`}
            label={item.caption ? dn : ""}
            values={item.caption ? summary : []}
            min={item._min}
            max={item._max}
            width={item.caption ? 140 : 0}
            type="linear"
            format=",.1f"
          />
          <Charts>{charts}</Charts>
          {item.units && (
            <ValueAxis id={`${item.value}_valueaxis`} value={value} detail={item.units} width={80} min={0} max={35} />
          )}
        </ChartRow>
      </ChartContainer>
    </Resizable>
  );
});

const HtxTimeSeriesChannel = inject("store")(observer(HtxTimeSeriesChannelView));

Registry.addTag("timeserieschannel", TimeSeriesChannelModel, HtxTimeSeriesChannel);

export { TimeSeriesChannelModel, HtxTimeSeriesChannel };
