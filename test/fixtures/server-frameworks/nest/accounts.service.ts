import { Injectable } from "@nestjs/common";

@Injectable()
export class AccountsService {
  async findOne(id: string) {
    return { id };
  }

  async create(body: { name: string }) {
    return { id: "new", ...body };
  }
}
