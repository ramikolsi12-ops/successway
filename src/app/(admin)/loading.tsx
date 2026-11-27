"use client";
import { Skeleton } from "antd";
export default function Loading() { return <div role="status" aria-label="Chargement en cours"><Skeleton active paragraph={{ rows: 10 }} /></div>; }
