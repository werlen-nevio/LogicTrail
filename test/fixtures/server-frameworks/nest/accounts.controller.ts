import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { AccountsService } from "./accounts.service";

@Controller("accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.accounts.findOne(id);
  }

  @Post()
  create(@Body() body: { name: string }) {
    return this.accounts.create(body);
  }
}
