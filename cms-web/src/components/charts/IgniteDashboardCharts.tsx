import { useEffect, useState } from "react";
import {
  CategoryChartType,
  IgrCategoryChart,
  IgrCategoryChartModule,
  IgrPieChart,
  IgrPieChartModule,
  LabelsPosition,
} from "igniteui-react-charts";



IgrCategoryChartModule.register();
IgrPieChartModule.register();

type ChartDatum = Record<string, string | number>;

type IgniteCategoryChartCardProps = {
  data: ChartDatum[];
  chartType: CategoryChartType;
  height?: string;
  brushes: string[];
};

type IgniteDonutChartCardProps = {
  data: ChartDatum[];
  valueMemberPath: string;
  labelMemberPath: string;
  height?: string;
  brushes: string[];
};

function ChartSkeleton({ height = "260px" }: { height?: string }) {
  return (
    <div
      className="animate-pulse rounded-2xl bg-gradient-to-br from-[#fff4e9] via-[#fffaf5] to-[#f8efe5]"
      style={{ height }}
    />
  );
}

export function IgniteCategoryChartCard({
  data,
  chartType,
  height = "260px",
  brushes,
}: IgniteCategoryChartCardProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <ChartSkeleton height={height} />;
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-[#fffaf6] p-2">
      <IgrCategoryChart
        width="100%"
        height={height}
        dataSource={data}
        chartType={chartType}
        brushes={brushes}
        outlines={brushes}
        yAxisMinimumValue={0}
        xAxisLabelTextColor="#7b6a58"
        yAxisLabelTextColor="#7b6a58"
        xAxisMajorStroke="#eadfce"
        yAxisMajorStroke="#eadfce"
        xAxisMajorStrokeThickness={1}
        yAxisMajorStrokeThickness={1}
        xAxisLabelTextStyle="600 11px Inter, sans-serif"
        yAxisLabelTextStyle="600 11px Inter, sans-serif"
        isTransitionInEnabled={true}
        transitionInDuration={900}
      />
    </div>
  );
}

export function IgniteDonutChartCard({
  data,
  valueMemberPath,
  labelMemberPath,
  height = "260px",
  brushes,
}: IgniteDonutChartCardProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <ChartSkeleton height={height} />;
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-[#fffaf6] p-2">
      <IgrPieChart
        width="100%"
        height={height}
        dataSource={data}
        valueMemberPath={valueMemberPath}
        labelMemberPath={labelMemberPath}
        legendLabelMemberPath={labelMemberPath}
        brushes={brushes}
        outlines={brushes}
        labelsPosition={LabelsPosition.BestFit}
        radiusFactor={0.82}
        innerExtent={58}
        allowSliceExplosion={true}
      />
    </div>
  );
}
