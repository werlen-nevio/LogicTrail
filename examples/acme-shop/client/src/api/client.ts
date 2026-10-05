import axios from "axios";

/** Shared axios instance for the JSON API. */
export const api = axios.create({ baseURL: "/api", withCredentials: true });
