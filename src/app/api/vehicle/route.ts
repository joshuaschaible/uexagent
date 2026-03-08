import { NextResponse } from "next/server";
import { getReferenceData, findVehicle } from "@/lib/data/cache";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");

  if (!name) {
    return NextResponse.json(null, { status: 400 });
  }

  const { vehicleMap } = await getReferenceData();
  const vehicle = findVehicle(name, vehicleMap);

  if (!vehicle) {
    return NextResponse.json(null, { status: 404 });
  }

  return NextResponse.json({
    id: vehicle.id,
    name: vehicle.name,
    name_full: vehicle.name_full,
    scu: vehicle.scu,
    pad_type: vehicle.pad_type,
    company_name: vehicle.company_name,
  });
}
