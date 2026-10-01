import { NextResponse } from "next/server";
import { getReferenceData, findVehicle } from "@/lib/data/cache";
import { assertTrustedHost, MAX_NAME_LENGTH, RequestError, requestErrorResponse } from "@/lib/request-security";

export async function GET(request: Request) {
  try {
    assertTrustedHost(request);
    const name = new URL(request.url).searchParams.get("name");
    if (name && name.length > MAX_NAME_LENGTH) {
      throw new RequestError(400, "The ship name is too long.");
    }
    return await getVehicle(request);
  } catch (error) {
    return requestErrorResponse(error);
  }
}

async function getVehicle(request: Request) {
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
